package com.wzy.aischeduler.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.nio.charset.StandardCharsets;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockMultipartFile;

import com.wzy.aischeduler.dto.UnifiedImportItemDTO;
import com.wzy.aischeduler.dto.UnifiedImportPreviewDTO;
import com.wzy.aischeduler.entity.CourseEvent;
import com.wzy.aischeduler.entity.Task;
import com.wzy.aischeduler.entity.User;
import com.wzy.aischeduler.repository.CourseEventRepository;
import com.wzy.aischeduler.repository.TaskRepository;
import com.wzy.aischeduler.repository.UserRepository;

class UnifiedImportServiceTests {
    private static final long USER_ID = 7L;
    private static final String PAST = "2020-01-15T23:59:00Z";
    private static final String FUTURE = "2099-01-15T23:59:00Z";

    private TaskRepository taskRepository;
    private CourseEventRepository courseEventRepository;
    private UnifiedImportService service;

    @BeforeEach
    void setUp() {
        taskRepository = mock(TaskRepository.class);
        courseEventRepository = mock(CourseEventRepository.class);
        UserRepository userRepository = mock(UserRepository.class);
        User user = new User();
        user.setId(USER_ID);
        when(userRepository.findById(USER_ID)).thenReturn(Optional.of(user));
        service = new UnifiedImportService(taskRepository, courseEventRepository, userRepository,
                mock(AiService.class), new CourseEventService(null, null));
    }

    private static String canvasJson(String... assignments) {
        return "[{\"name\":\"Assignments\",\"assignments\":[" + String.join(",", assignments) + "]}]";
    }

    private static String assignment(String name, String url, String dueAt) {
        String due = dueAt == null ? "null" : "\"" + dueAt + "\"";
        return "{\"id\":1,\"name\":\"" + name + "\",\"html_url\":\"" + url + "\",\"due_at\":" + due + "}";
    }

    private UnifiedImportPreviewDTO preview(String json) {
        return service.preview(new MockMultipartFile("file", "canvas.json", "application/json",
                json.getBytes(StandardCharsets.UTF_8)), USER_ID, "America/Chicago");
    }

    @Test
    void sameTitleInDifferentCoursesGetDistinctKeysAndBothAreNew() {
        UnifiedImportPreviewDTO preview = preview(canvasJson(
                assignment("Homework 1", "https://canvas.edu/courses/10/assignments/1", FUTURE),
                assignment("Homework 1", "https://canvas.edu/courses/20/assignments/1", FUTURE)));

        assertEquals(2, preview.getItems().size());
        assertNotEquals(preview.getItems().get(0).getImportKey(), preview.getItems().get(1).getImportKey());
        preview.getItems().forEach(item -> assertEquals("new", item.getStatus()));

        Map<String, Object> result = service.confirm(preview.getImportId(), null, USER_ID);
        assertEquals(2, result.get("tasksCreated"));
    }

    @Test
    void pastItemsAreFlaggedAndUpcomingAreNot() {
        UnifiedImportPreviewDTO preview = preview(canvasJson(
                assignment("Old", "https://canvas.edu/a/1", PAST),
                assignment("Soon", "https://canvas.edu/a/2", FUTURE),
                assignment("Undated", "https://canvas.edu/a/3", null)));

        assertTrue(preview.getItems().get(0).isPast());
        assertFalse(preview.getItems().get(1).isPast());
        assertFalse(preview.getItems().get(2).isPast());
    }

    @Test
    void emptySelectionWritesNothing() {
        UnifiedImportPreviewDTO preview = preview(canvasJson(assignment("HW", "https://canvas.edu/a/1", FUTURE)));

        Map<String, Object> result = service.confirm(preview.getImportId(), List.of(), USER_ID);

        verify(taskRepository, never()).save(any());
        assertEquals(0, result.get("tasksCreated"));
        assertEquals(1, result.get("skipped"));
    }

    @Test
    void existingItemsAreCountedAsDuplicatesNotCreated() {
        Task existing = new Task();
        existing.setImportKey("canvas:https://canvas.edu/a/1");
        existing.setDueDate(LocalDateTime.parse("2099-01-15T23:59:00"));
        when(taskRepository.findFirstByUserIdAndImportKey(USER_ID, "canvas:https://canvas.edu/a/1"))
                .thenReturn(Optional.of(existing));

        UnifiedImportPreviewDTO preview = preview(canvasJson(
                assignment("Already here", "https://canvas.edu/a/1", FUTURE),
                assignment("Brand new", "https://canvas.edu/a/2", FUTURE)));
        assertEquals("duplicate", preview.getItems().get(0).getStatus());
        assertEquals("new", preview.getItems().get(1).getStatus());

        Map<String, Object> result = service.confirm(preview.getImportId(), null, USER_ID);

        assertEquals(1, result.get("tasksCreated"));
        assertEquals(1, result.get("duplicates"));
        assertEquals(1, result.get("tasks"));
    }

    @Test
    void changedDeadlineUpdatesTheExistingTaskInsteadOfBeingSkipped() {
        Task existing = new Task();
        existing.setTitle("Essay (my own title)");
        existing.setDescription("my notes");
        existing.setCompleted(true);
        existing.setImportKey("canvas:https://canvas.edu/a/1");
        existing.setDueDate(LocalDateTime.parse("2099-01-10T23:59:00"));
        when(taskRepository.findFirstByUserIdAndImportKey(USER_ID, "canvas:https://canvas.edu/a/1"))
                .thenReturn(Optional.of(existing));

        UnifiedImportPreviewDTO preview = preview(canvasJson(assignment("Essay", "https://canvas.edu/a/1", FUTURE)));
        UnifiedImportItemDTO item = preview.getItems().get(0);
        assertEquals("update", item.getStatus());
        assertEquals("2099-01-10T23:59", item.getExistingDueDate());

        Map<String, Object> result = service.confirm(preview.getImportId(), null, USER_ID);

        assertEquals(1, result.get("tasksUpdated"));
        assertEquals(0, result.get("tasksCreated"));
        assertEquals(LocalDateTime.parse("2099-01-15T23:59:00"), existing.getDueDate());
        // The user's own edits and progress survive an update.
        assertEquals("Essay (my own title)", existing.getTitle());
        assertEquals("my notes", existing.getDescription());
        assertTrue(existing.isCompleted());
    }

    @Test
    void anUndatedImportNeverBlanksAStoredDeadline() {
        Task existing = new Task();
        existing.setImportKey("canvas:https://canvas.edu/a/1");
        LocalDateTime stored = LocalDateTime.parse("2099-01-10T23:59:00");
        existing.setDueDate(stored);
        when(taskRepository.findFirstByUserIdAndImportKey(USER_ID, "canvas:https://canvas.edu/a/1"))
                .thenReturn(Optional.of(existing));

        UnifiedImportPreviewDTO preview = preview(canvasJson(assignment("Essay", "https://canvas.edu/a/1", null)));
        assertEquals("duplicate", preview.getItems().get(0).getStatus());

        service.confirm(preview.getImportId(), null, USER_ID);

        assertEquals(stored, existing.getDueDate());
    }

    @Test
    void aTaskImportedBeforeKeysExistedIsRecognisedAndAdoptsTheKey() {
        Task legacy = new Task();
        legacy.setTitle("HW");
        when(taskRepository.findByUserIdAndTitleAndDueDate(eq(USER_ID), eq("HW"), any(LocalDateTime.class)))
                .thenReturn(List.of(legacy));

        UnifiedImportPreviewDTO preview = preview(canvasJson(assignment("HW", "https://canvas.edu/a/1", FUTURE)));
        assertEquals("duplicate", preview.getItems().get(0).getStatus());

        Map<String, Object> result = service.confirm(preview.getImportId(), null, USER_ID);

        assertEquals(0, result.get("tasksCreated"));
        assertEquals("canvas:https://canvas.edu/a/1", legacy.getImportKey());
    }

    @Test
    void aRowKeyedToADifferentItemIsNotADuplicateEvenWithTheSameTitleAndDeadline() {
        Task other = new Task();
        other.setImportKey("canvas:https://canvas.edu/courses/20/assignments/1");
        when(taskRepository.findByUserIdAndTitleAndDueDate(eq(USER_ID), eq("Homework 1"), any(LocalDateTime.class)))
                .thenReturn(List.of(other));

        UnifiedImportPreviewDTO preview = preview(canvasJson(
                assignment("Homework 1", "https://canvas.edu/courses/10/assignments/1", FUTURE)));

        assertEquals("new", preview.getItems().get(0).getStatus());
    }

    @Test
    void theApiPayloadCarriesStatusAndPastButNeverTheInternalImportKey() throws Exception {
        UnifiedImportPreviewDTO preview = preview(canvasJson(assignment("HW", "https://canvas.edu/a/1", PAST)));
        assertEquals("canvas:https://canvas.edu/a/1", preview.getItems().get(0).getImportKey());

        com.fasterxml.jackson.databind.ObjectMapper mapper = new com.fasterxml.jackson.databind.ObjectMapper();
        com.fasterxml.jackson.databind.JsonNode item = mapper.readTree(mapper.writeValueAsString(preview)).path("items").get(0);

        assertEquals("new", item.path("status").asText());
        assertTrue(item.path("past").asBoolean());
        assertFalse(item.has("importKey"));

        // Same guarantee for the entity: clients can neither read nor set the key.
        Task task = new Task();
        task.setImportKey("canvas:secret");
        assertFalse(mapper.readTree(mapper.writeValueAsString(task)).has("importKey"));
        assertNull(mapper.readValue("{\"title\":\"x\",\"importKey\":\"forged\"}", Task.class).getImportKey());
    }

    @Test
    void reimportingTheSameCalendarDoesNotDuplicateClassSessions() {
        String ics = "BEGIN:VCALENDAR\nBEGIN:VEVENT\nSUMMARY:CS 101\nLOCATION:Room 1\n"
                + "DTSTART:20990105T150000Z\nDTEND:20990105T160000Z\nEND:VEVENT\nEND:VCALENDAR\n";
        CourseEvent stored = new CourseEvent();
        stored.setTitle("CS 101");
        stored.setStartTime(LocalDateTime.parse("2099-01-05T15:00:00"));
        stored.setEndTime(LocalDateTime.parse("2099-01-05T16:00:00"));
        when(courseEventRepository.findByUserId(anyLong())).thenReturn(List.of(stored));

        UnifiedImportPreviewDTO preview = service.preview(new MockMultipartFile("file", "cal.ics", "text/calendar",
                ics.getBytes(StandardCharsets.UTF_8)), USER_ID, "UTC");
        assertEquals("duplicate", preview.getItems().get(0).getStatus());

        Map<String, Object> result = service.confirm(preview.getImportId(), null, USER_ID);

        verify(courseEventRepository, never()).save(any());
        assertEquals(0, result.get("coursesCreated"));
        assertEquals(1, result.get("duplicates"));
        assertNull(preview.getItems().get(0).getExistingDueDate());
    }
}
