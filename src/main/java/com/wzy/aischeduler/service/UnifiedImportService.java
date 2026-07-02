package com.wzy.aischeduler.service;

import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;

import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.wzy.aischeduler.dto.UnifiedImportItemDTO;
import com.wzy.aischeduler.dto.UnifiedImportPreviewDTO;
import com.wzy.aischeduler.entity.CourseEvent;
import com.wzy.aischeduler.entity.Task;
import com.wzy.aischeduler.entity.User;
import com.wzy.aischeduler.repository.CourseEventRepository;
import com.wzy.aischeduler.repository.TaskRepository;
import com.wzy.aischeduler.repository.UserRepository;

@Service
public class UnifiedImportService {
    private final ObjectMapper objectMapper = new ObjectMapper();
    private final ConcurrentMap<String, UnifiedImportPreviewDTO> previews = new ConcurrentHashMap<>();

    private final TaskRepository taskRepository;
    private final CourseEventRepository courseEventRepository;
    private final UserRepository userRepository;
    private final AiService aiService;
    private final CourseEventService courseEventService;

    public UnifiedImportService(TaskRepository taskRepository,
                                CourseEventRepository courseEventRepository,
                                UserRepository userRepository,
                                AiService aiService,
                                CourseEventService courseEventService) {
        this.taskRepository = taskRepository;
        this.courseEventRepository = courseEventRepository;
        this.userRepository = userRepository;
        this.aiService = aiService;
        this.courseEventService = courseEventService;
    }

    public UnifiedImportPreviewDTO preview(MultipartFile file, Long userId, String timezone) {
        if (file == null || file.isEmpty()) {
            throw new IllegalArgumentException("Please select a file to import.");
        }
        requireUser(userId);
        try {
            byte[] bytes = file.getBytes();
            String text = new String(bytes, StandardCharsets.UTF_8);
            UnifiedImportPreviewDTO preview;
            String fileName = Optional.ofNullable(file.getOriginalFilename()).orElse("upload");
            if (looksLikeIcs(fileName, text)) {
                preview = previewIcs(fileName, bytes, timezone);
            } else {
                JsonNode root = objectMapper.readTree(bytes);
                preview = previewJson(fileName, root, text);
            }
            preview.setImportId(UUID.randomUUID().toString());
            preview.setFileName(fileName);
            preview.setSummary(buildSummary(preview));
            previews.put(preview.getImportId(), preview);
            return preview;
        } catch (Exception exception) {
            throw new IllegalArgumentException("Import preview failed: " + exception.getMessage(), exception);
        }
    }

    public Map<String, Object> confirm(String importId, List<String> itemIds, Long userId) {
        User user = requireUser(userId);
        UnifiedImportPreviewDTO preview = previews.get(importId);
        if (preview == null) {
            throw new IllegalArgumentException("Import preview expired. Please upload the file again.");
        }

        List<String> selected = itemIds == null || itemIds.isEmpty()
                ? preview.getItems().stream().map(UnifiedImportItemDTO::getId).toList()
                : itemIds;

        int tasks = 0;
        int courses = 0;
        int skipped = 0;
        for (UnifiedImportItemDTO item : preview.getItems()) {
            if (!selected.contains(item.getId())) {
                skipped++;
                continue;
            }
            if ("task".equals(item.getKind())) {
                saveTask(item, user);
                tasks++;
            } else if ("course".equals(item.getKind())) {
                saveCourse(item, user);
                courses++;
            } else {
                skipped++;
            }
        }

        previews.remove(importId);
        return Map.of("tasks", tasks, "courses", courses, "skipped", skipped);
    }

    private UnifiedImportPreviewDTO previewJson(String fileName, JsonNode root, String rawText) {
        if (isCanvas(root)) {
            return previewCanvas(root);
        }
        if (isCoursera(root)) {
            return previewCoursera(root);
        }
        UnifiedImportPreviewDTO aiPreview = previewUnknownJsonWithAi(rawText);
        return aiPreview.getItems().isEmpty() ? previewUnknownJson(root) : aiPreview;
    }

    private UnifiedImportPreviewDTO previewCanvas(JsonNode root) {
        UnifiedImportPreviewDTO preview = basePreview("canvas-json", false);
        int index = 1;
        for (JsonNode group : root) {
            String groupName = group.path("name").asText("Canvas");
            JsonNode assignments = group.path("assignments");
            if (!assignments.isArray()) {
                continue;
            }
            for (JsonNode assignment : assignments) {
                String title = assignment.path("name").asText("");
                if (title.isBlank()) {
                    continue;
                }
                UnifiedImportItemDTO item = taskItem("canvas-" + index++, "Canvas", title);
                item.setDueDate(parseDateToUtcString(assignment.path("due_at").asText(null)));
                item.setDescription("From Canvas Group: " + groupName + "\nURL: " + assignment.path("html_url").asText(""));
                item.setConfidence(0.98);
                item.setNotes("Canvas parser matched assignments[].");
                preview.getItems().add(item);
            }
        }
        return preview;
    }

    private UnifiedImportPreviewDTO previewCoursera(JsonNode root) {
        UnifiedImportPreviewDTO preview = basePreview("coursera-json", false);
        JsonNode items = root.path("linked").path("onDemandCourseMaterialItems.v2");
        int index = 1;
        if (items.isArray()) {
            for (JsonNode raw : items) {
                String title = raw.path("name").asText("");
                if (title.isBlank()) {
                    continue;
                }
                UnifiedImportItemDTO item = taskItem("coursera-" + index++, "Coursera", title);
                long commitmentMs = raw.path("timeCommitment").asLong(0);
                double hours = commitmentMs / (1000.0 * 60 * 60);
                item.setDescription(String.format("Source: Coursera\nEstimated time: %.2f hours\nSlug: %s", hours, raw.path("slug").asText("")));
                item.setConfidence(0.92);
                item.setNotes("Coursera parser matched linked.onDemandCourseMaterialItems.v2.");
                preview.getItems().add(item);
            }
        }
        return preview;
    }

    private UnifiedImportPreviewDTO previewUnknownJson(JsonNode root) {
        UnifiedImportPreviewDTO preview = basePreview("ai-cleanup-json", true);
        List<JsonNode> candidates = new ArrayList<>();
        collectObjectCandidates(root, candidates, 0);
        int index = 1;
        for (JsonNode candidate : candidates.stream().limit(40).toList()) {
            String title = firstText(candidate, "title", "name", "summary", "assignment", "task");
            if (title == null || title.isBlank()) {
                continue;
            }
            UnifiedImportItemDTO item = taskItem("ai-json-" + index++, "AI cleanup", title);
            item.setDueDate(parseDateToUtcString(firstText(candidate, "due_at", "dueDate", "due", "deadline", "end_at")));
            item.setDescription("AI cleanup candidate from unknown JSON structure.");
            item.setConfidence(item.getDueDate() == null ? 0.54 : 0.68);
            item.setNotes("Unknown JSON: review before confirming. LLM cleanup can be enabled with LLM_API_KEY.");
            preview.getItems().add(item);
        }
        return preview;
    }

    private UnifiedImportPreviewDTO previewUnknownJsonWithAi(String rawText) {
        UnifiedImportPreviewDTO preview = basePreview("ai-cleanup-json", true);
        try {
            JsonNode aiItems = objectMapper.readTree(extractJsonArray(aiService.cleanupImportJson(rawText)));
            if (!aiItems.isArray()) {
                return preview;
            }
            int index = 1;
            for (JsonNode aiItem : aiItems) {
                String title = aiItem.path("title").asText("");
                if (title.isBlank()) {
                    continue;
                }
                UnifiedImportItemDTO item = taskItem("ai-json-" + index++, "AI cleanup", title);
                item.setDueDate(parseDateToUtcString(aiItem.path("dueDate").asText(null)));
                item.setDescription(aiItem.path("description").asText("AI-cleaned item from unknown JSON."));
                item.setConfidence(aiItem.path("confidence").asDouble(0.7));
                item.setNotes("AI cleanup normalized this unknown JSON item. Review before confirming.");
                preview.getItems().add(item);
            }
        } catch (Exception ignored) {
            return preview;
        }
        return preview;
    }

    private UnifiedImportPreviewDTO previewIcs(String fileName, byte[] bytes, String timezone) {
        UnifiedImportPreviewDTO preview = basePreview("ics-calendar", false);
        ZoneId zoneId = ZoneId.of(timezone == null || timezone.isBlank() ? "America/Chicago" : timezone);
        List<CourseEvent> events = courseEventService.parseEvents(new ByteArrayInputStream(bytes), zoneId);
        int index = 1;
        for (CourseEvent event : events) {
            UnifiedImportItemDTO item = new UnifiedImportItemDTO();
            item.setId("ics-" + index++);
            item.setKind("course");
            item.setSource("ICS");
            item.setTitle(event.getTitle());
            item.setLocation(event.getLocation());
            item.setStart(event.getStartTime().toString());
            item.setEnd(event.getEndTime().toString());
            item.setConfidence(0.88);
            item.setNotes("ICS parser matched VEVENT and expanded supported recurrence rules.");
            preview.getItems().add(item);
        }
        return preview;
    }

    private UnifiedImportPreviewDTO basePreview(String parser, boolean aiFallbackUsed) {
        UnifiedImportPreviewDTO preview = new UnifiedImportPreviewDTO();
        preview.setParser(parser);
        preview.setAiFallbackUsed(aiFallbackUsed);
        return preview;
    }

    private UnifiedImportItemDTO taskItem(String id, String source, String title) {
        UnifiedImportItemDTO item = new UnifiedImportItemDTO();
        item.setId(id);
        item.setKind("task");
        item.setSource(source);
        item.setTitle(title);
        item.setConfidence(0.8);
        return item;
    }

    private void saveTask(UnifiedImportItemDTO item, User user) {
        if (!taskRepository.findByTitleAndUserId(item.getTitle(), user.getId()).isEmpty()) {
            return;
        }
        Task task = new Task();
        task.setUser(user);
        task.setTitle(item.getTitle());
        task.setDescription(item.getDescription());
        if (item.getDueDate() != null && !item.getDueDate().isBlank()) {
            task.setDueDate(LocalDateTime.parse(item.getDueDate()));
        }
        taskRepository.save(task);
    }

    private void saveCourse(UnifiedImportItemDTO item, User user) {
        if (item.getStart() == null || item.getEnd() == null) {
            return;
        }
        CourseEvent event = new CourseEvent();
        event.setUser(user);
        event.setTitle(item.getTitle());
        event.setLocation(item.getLocation());
        event.setStartTime(LocalDateTime.parse(item.getStart()));
        event.setEndTime(LocalDateTime.parse(item.getEnd()));
        courseEventRepository.save(event);
    }

    private User requireUser(Long userId) {
        if (userId == null) {
            throw new IllegalArgumentException("Please sign in before importing.");
        }
        return userRepository.findById(userId)
                .orElseThrow(() -> new IllegalArgumentException("Signed-in user was not found."));
    }

    private boolean isCanvas(JsonNode root) {
        return root.isArray() && root.size() > 0 && root.get(0).has("assignments");
    }

    private boolean isCoursera(JsonNode root) {
        return root.path("linked").path("onDemandCourseMaterialItems.v2").isArray();
    }

    private boolean looksLikeIcs(String fileName, String text) {
        String lower = fileName.toLowerCase();
        return lower.endsWith(".ics") || text.contains("BEGIN:VCALENDAR") || text.contains("BEGIN:VEVENT");
    }

    private String buildSummary(UnifiedImportPreviewDTO preview) {
        long tasks = preview.getItems().stream().filter(item -> "task".equals(item.getKind())).count();
        long courses = preview.getItems().stream().filter(item -> "course".equals(item.getKind())).count();
        String ai = preview.isAiFallbackUsed() ? " AI cleanup suggested; review carefully." : "";
        return "Detected " + tasks + " tasks and " + courses + " course sessions with " + preview.getParser() + "." + ai;
    }

    private void collectObjectCandidates(JsonNode node, List<JsonNode> output, int depth) {
        if (node == null || depth > 6 || output.size() > 80) {
            return;
        }
        if (node.isObject()) {
            if (firstText(node, "title", "name", "summary", "assignment", "task") != null) {
                output.add(node);
            }
            Iterator<JsonNode> children = node.elements();
            while (children.hasNext()) {
                collectObjectCandidates(children.next(), output, depth + 1);
            }
        } else if (node.isArray()) {
            for (JsonNode child : node) {
                collectObjectCandidates(child, output, depth + 1);
            }
        }
    }

    private String firstText(JsonNode node, String... keys) {
        for (String key : keys) {
            JsonNode value = node.path(key);
            if (value.isTextual() && !value.asText().isBlank()) {
                return value.asText();
            }
        }
        return null;
    }

    private String parseDateToUtcString(String raw) {
        if (raw == null || raw.isBlank() || "null".equals(raw)) {
            return null;
        }
        try {
            return ZonedDateTime.parse(raw).withZoneSameInstant(ZoneId.of("UTC")).toLocalDateTime().toString();
        } catch (Exception ignored) {
            try {
                return LocalDateTime.parse(raw).toString();
            } catch (Exception ignoredAgain) {
                try {
                    return LocalDate.parse(raw).atStartOfDay().toString();
                } catch (Exception finalIgnored) {
                    return null;
                }
            }
        }
    }

    private String extractJsonArray(String text) {
        if (text == null) {
            return "[]";
        }
        int start = text.indexOf('[');
        int end = text.lastIndexOf(']');
        if (start >= 0 && end > start) {
            return text.substring(start, end + 1);
        }
        return "[]";
    }

    private List<Map<String, String>> parseIcsBlocks(String text) {
        List<Map<String, String>> events = new ArrayList<>();
        Map<String, String> current = null;
        String previousKey = null;
        for (String rawLine : text.replace("\r\n", "\n").split("\n")) {
            String line = rawLine.stripTrailing();
            if (line.startsWith(" ") && current != null && previousKey != null) {
                current.put(previousKey, current.get(previousKey) + line.substring(1));
                continue;
            }
            if ("BEGIN:VEVENT".equals(line)) {
                current = new java.util.LinkedHashMap<>();
                previousKey = null;
                continue;
            }
            if ("END:VEVENT".equals(line)) {
                if (current != null) {
                    events.add(current);
                }
                current = null;
                previousKey = null;
                continue;
            }
            if (current != null && line.contains(":")) {
                int split = line.indexOf(':');
                previousKey = line.substring(0, split);
                current.put(previousKey, line.substring(split + 1));
            }
        }
        return events;
    }

    private LocalDateTime parseIcsDate(Map<String, String> raw, String prefix, ZoneId defaultZone) {
        Map.Entry<String, String> entry = raw.entrySet().stream()
                .filter(item -> item.getKey().equals(prefix) || item.getKey().startsWith(prefix + ";"))
                .findFirst()
                .orElse(null);
        if (entry == null) {
            return null;
        }
        String value = entry.getValue();
        ZoneId zone = defaultZone;
        int tzIndex = entry.getKey().indexOf("TZID=");
        if (tzIndex >= 0) {
            zone = ZoneId.of(entry.getKey().substring(tzIndex + 5).split(";")[0]);
        }
        try {
            if (value.endsWith("Z")) {
                return ZonedDateTime.parse(value, DateTimeFormatter.ofPattern("yyyyMMdd'T'HHmmssX"))
                        .withZoneSameInstant(ZoneId.of("UTC")).toLocalDateTime();
            }
            if (value.length() == 8) {
                return LocalDate.parse(value, DateTimeFormatter.ofPattern("yyyyMMdd"))
                        .atStartOfDay(zone).withZoneSameInstant(ZoneId.of("UTC")).toLocalDateTime();
            }
            return LocalDateTime.parse(value, DateTimeFormatter.ofPattern("yyyyMMdd'T'HHmmss"))
                    .atZone(zone).withZoneSameInstant(ZoneId.of("UTC")).toLocalDateTime();
        } catch (Exception exception) {
            return null;
        }
    }

    private String firstValue(Map<String, String> raw, String key, String fallback) {
        return raw.entrySet().stream()
                .filter(entry -> entry.getKey().equals(key) || entry.getKey().startsWith(key + ";"))
                .map(Map.Entry::getValue)
                .findFirst()
                .orElse(fallback);
    }
}
