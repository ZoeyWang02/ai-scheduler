package com.wzy.aischeduler.service;

import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.time.format.TextStyle;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.stream.Collectors;
import java.util.stream.IntStream;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.RestClient;

import com.wzy.aischeduler.dto.LifestyleAnalysisDTO;
import com.wzy.aischeduler.entity.Task;
import com.wzy.aischeduler.repository.TaskRepository;

@Service
public class AiService {

    @Value("${llm.api.url}")
    private String apiUrl;

    @Value("${llm.api.key}")
    private String apiKey;

    @Value("${llm.model}")
    private String model;

    // Optional second model, used when the main one hits its rate limit (limits are per model).
    @Value("${llm.fallback-model:}")
    private String fallbackModel;

    @Autowired
    private TaskRepository taskRepository;

    @Autowired
    private LifestyleAnalysisService lifestyleAnalysisService;

    @Autowired
    private CourseEventService courseEventService;

    private final RestClient restClient;

    public AiService() {
        this.restClient = RestClient.create();
    }

    /**
     * 静态拆解任务方法 (用于测试)
     */
    public String breakDownTask(String taskTitle, String taskDescription) {
        if (apiKey == null || apiKey.isBlank()) {
            return "[]";
        }
        String systemPrompt = "你是一个专业的常春藤名校学术时间管理专家。你的任务是帮学生把大型作业拆解成易于执行的子任务。请以纯 JSON 数组格式返回，不要包含任何额外的 Markdown 标记或闲聊。格式示例：[{\"step\": \"第一步名称\", \"estimatedHours\": 2}, ...]";
        String userPrompt = "请拆解这个作业。标题：[" + taskTitle + "]。详细描述：[" + taskDescription + "]";

        Map<String, Object> requestBody = Map.of(
                "model", model,
                "temperature", 0.3,
                "messages", List.of(
                        Map.of("role", "system", "content", systemPrompt),
                        Map.of("role", "user", "content", userPrompt)
                )
        );

        try {
            Map<String, Object> response = restClient.post()
                    .uri(apiUrl)
                    .header(HttpHeaders.AUTHORIZATION, "Bearer " + apiKey)
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(requestBody)
                    .retrieve()
                    .body(Map.class);

            List<Map<String, Object>> choices = (List<Map<String, Object>>) response.get("choices");
            Map<String, Object> message = (Map<String, Object>) choices.get(0).get("message");
            return (String) message.get("content");
        } catch (Exception e) {
            System.err.println("❌ AI 请求失败: " + e.getMessage());
            return "[]";
        }
    }

    /**
     * 自由聊天方法 (默认重载)
     */
    public String chat(String userMessage) {
        return chat(userMessage, null, "America/Chicago", "en");
    }

    public String cleanupImportJson(String jsonSample) {
        if (apiKey == null || apiKey.isBlank()) {
            return "[]";
        }
        String boundedSample = jsonSample == null ? "" : jsonSample.substring(0, Math.min(jsonSample.length(), 12000));
        String systemPrompt = "You normalize unknown academic JSON imports. Return only a JSON array. "
                + "Each item must be {\"kind\":\"task\",\"title\":\"...\",\"description\":\"...\",\"dueDate\":\"ISO optional\",\"confidence\":0.0}. "
                + "Use kind=task only. Do not include markdown.";
        String userPrompt = "Extract coursework tasks from this JSON. If uncertain, use lower confidence. JSON:\n" + boundedSample;

        Map<String, Object> requestBody = Map.of(
                "model", model,
                "temperature", 0.1,
                "messages", List.of(
                        Map.of("role", "system", "content", systemPrompt),
                        Map.of("role", "user", "content", userPrompt)
                )
        );

        try {
            Map<String, Object> response = restClient.post()
                    .uri(apiUrl)
                    .header(HttpHeaders.AUTHORIZATION, "Bearer " + apiKey)
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(requestBody)
                    .retrieve()
                    .body(Map.class);
            List<Map<String, Object>> choices = (List<Map<String, Object>>) response.get("choices");
            Map<String, Object> message = (Map<String, Object>) choices.get(0).get("message");
            return (String) message.get("content");
        } catch (Exception e) {
            System.err.println("AI import cleanup failed: " + e.getMessage());
            return "[]";
        }
    }

    public boolean isConfigured() {
        return apiKey != null && !apiKey.isBlank();
    }

    /**
     * 单条文本翻译（用户主动点击触发，不做批量/自动翻译）
     */
    public String translateText(String text, String targetLang) {
        if (apiKey == null || apiKey.isBlank()) {
            return text;
        }
        if (text == null || text.isBlank()) {
            return text;
        }
        boolean isEn = "en".equals(targetLang);
        String systemPrompt = isEn
                ? "You are a translator. Translate the user's text into English. Return ONLY the translated text, no quotes, no explanation, no markdown."
                : "你是一个翻译助手。请将用户提供的文本翻译成中文。只返回翻译结果，不要引号、不要解释、不要 markdown。";

        Map<String, Object> requestBody = Map.of(
                "model", model,
                "temperature", 0.2,
                "messages", List.of(
                        Map.of("role", "system", "content", systemPrompt),
                        Map.of("role", "user", "content", text)
                )
        );

        try {
            Map<String, Object> response = restClient.post()
                    .uri(apiUrl)
                    .header(HttpHeaders.AUTHORIZATION, "Bearer " + apiKey)
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(requestBody)
                    .retrieve()
                    .body(Map.class);
            List<Map<String, Object>> choices = (List<Map<String, Object>>) response.get("choices");
            Map<String, Object> message = (Map<String, Object>) choices.get(0).get("message");
            return ((String) message.get("content")).trim();
        } catch (Exception e) {
            System.err.println("❌ AI 翻译请求失败: " + e.getMessage());
            throw new RuntimeException("Translation failed", e);
        }
    }

    /**
     * Models are unreliable at working out which date "Friday" is, so the prompt spells it out:
     * the next 14 days with their weekday names, today and tomorrow marked.
     */
    static String buildCalendarContext(LocalDate today, boolean isEn) {
        Locale locale = isEn ? Locale.ENGLISH : Locale.SIMPLIFIED_CHINESE;
        return IntStream.range(0, 14).mapToObj(i -> {
            LocalDate day = today.plusDays(i);
            String note = switch (i) {
                case 0 -> isEn ? " (today)" : "（今天）";
                case 1 -> isEn ? " (tomorrow)" : "（明天）";
                case 2 -> isEn ? "" : "（后天）";
                default -> "";
            };
            return day + " " + day.getDayOfWeek().getDisplayName(TextStyle.SHORT, locale) + note;
        }).collect(Collectors.joining(isEn ? "; " : "；"));
    }

    /**
     * 核心双语聊天方法
     */
    public String chat(String userMessage, Long userId, String userTimezone, String lang) {
        return chat(userMessage, userId, userTimezone, lang, List.of());
    }

    static final int MAX_HISTORY_MESSAGES = 8;
    static final int MAX_HISTORY_CHARS = 1500;

    /**
     * Earlier turns of the same conversation, so a follow-up such as "move them to the evening"
     * can be understood. Only user/assistant turns are kept, only the most recent few, each capped
     * in length; anything else (including a client trying to inject a "system" turn) is dropped.
     */
    static List<Map<String, String>> sanitizeHistory(List<Map<String, String>> raw) {
        if (raw == null) return List.of();
        List<Map<String, String>> kept = new java.util.ArrayList<>();
        for (Map<String, String> turn : raw) {
            if (turn == null) continue;
            String role = turn.get("role");
            String content = turn.get("content");
            if (content == null || content.isBlank()) continue;
            if (!"user".equals(role) && !"assistant".equals(role)) continue;
            String trimmed = content.length() > MAX_HISTORY_CHARS ? content.substring(0, MAX_HISTORY_CHARS) + "…" : content;
            kept.add(Map.of("role", role, "content", trimmed));
        }
        int from = Math.max(0, kept.size() - MAX_HISTORY_MESSAGES);
        return List.copyOf(kept.subList(from, kept.size()));
    }

    static List<Map<String, String>> buildMessages(String systemPrompt, List<Map<String, String>> history, String userMessage) {
        List<Map<String, String>> messages = new java.util.ArrayList<>();
        messages.add(Map.of("role", "system", "content", systemPrompt));
        messages.addAll(sanitizeHistory(history));
        messages.add(Map.of("role", "user", "content", userMessage));
        return messages;
    }

    public String chat(String userMessage, Long userId, String userTimezone, String lang, List<Map<String, String>> history) {
        boolean isEn = "en".equals(lang);

        // 🌟 1. 强力语言指令
        String langInstruction = isEn 
            ? "CRITICAL: You MUST communicate with the user, answer their questions, and output the recommended schedule block names (step/reason) ENTIRELY IN ENGLISH." 
            : "关键规则：请全程使用中文回答用户并提供建议。";

        // 🌟 2. 提取任务上下文 (双语前缀)
        if (apiKey == null || apiKey.isBlank()) {
            return "AI service is not configured. Set LLM_API_KEY and restart the server.";
        }

        List<Task> tasks = userId == null ? List.of() : taskRepository.findByUserId(userId);
        String taskContext = tasks.stream()
                .map(t -> "- id=" + t.getId() + (isEn ? ", title=" : ", 标题=") + t.getTitle() + (isEn ? ", Due=" : ", 截止日期=") + t.getDueDate())
                .collect(Collectors.joining("\n"));

        // 🌟 3. 提取作息画像 (LifestyleService 已经处理过双语了，这里只处理前缀)
        LifestyleAnalysisDTO lifestyle = lifestyleAnalysisService.analyze("week", userTimezone, userId, lang);
        String lifestyleContext = isEn 
            ? "User's rhythm profile: " + lifestyle.getRhythmLabel() + "; Focus style: " + lifestyle.getFocusStyle() + "; Peak window: " + lifestyle.getPeakWindow() + "; Recommendation: " + lifestyle.getRecommendation()
            : "用户近期作息画像：" + lifestyle.getRhythmLabel() + "；偏好专注模式：" + lifestyle.getFocusStyle() + "；高能时间：" + lifestyle.getPeakWindow() + "；排期建议：" + lifestyle.getRecommendation();

        // 🌟 4. 提取繁忙时间
        String busyContext = courseEventService.buildBusyContext(userId, userTimezone);

        // 🌟 5. 获取当前时间
        java.time.ZonedDateTime userCurrentTime = java.time.ZonedDateTime.now(java.time.ZoneId.of(userTimezone));
        String currentTime = userCurrentTime.format(DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss"));

        // 🌟 6. 组装终极双语 System Prompt
        String systemPrompt = (isEn ? "You are a UIUC academic assistant. Here are the user's current tasks:\n" : "你是一个UIUC的学术助理。以下是用户的课程作业：\n") + taskContext +
                "\n\n" + lifestyleContext +
                (isEn ? "\n\nAvoid these busy times for the next two weeks:\n" : "\n\n以下是用户未来两周的课程/不可用时间，排计划必须避开这些时间：\n") + busyContext +
                (isEn ? "\n\nCurrent time is: " : "\n\n现在的时间是：") + currentTime + "。" +
                (isEn ? "\nCalendar for the next 14 days (use it to resolve weekdays and relative dates; a bare weekday such as \"Friday\" means the first such day in this list): "
                      : "\n未来14天的日历（请用它换算星期几和相对日期；单说“周五”指此列表中第一个周五）：") +
                buildCalendarContext(userCurrentTime.toLocalDate(), isEn) + "。" +
                (isEn 
                    ? "\nFirst decide what the user wants, then answer accordingly:" +
                      "\n(A) The user TELLS you about an event or commitment with a time (a meeting, class, exam, appointment, deadline), e.g. \"I have a meeting tomorrow at 8pm\". Record exactly that: one short confirmation sentence, then a JSON array with ONE add item for that event. step = the event in the user's own words, suggestedDate = the exact time they gave (work out \"tomorrow\", \"Friday\" etc. from the current time above), estimatedHours = the duration they gave, otherwise 1. The scheduling rules below do NOT apply to a time the user fixed, even at night. Do NOT add any other items and do NOT move existing tasks. If they gave no time, ask for it and return no JSON." +
                      "\n(B) The user ASKS you to plan, schedule, break down or prioritize work. Make a plan that follows the scheduling rules: every suggestedDate between 06:00 and 23:00 (user's local time), never overlapping busy times; if there is not enough data prefer 09:00-11:30, 14:00-17:00, 19:00-22:00. You may add, reduce or cancel tasks; to delete an existing task return action=delete with its taskId." +
                      "\n(C) Anything else (a question, chat, thanks): answer briefly in plain text with NO JSON." +
                      "\nThe task list above is background only: never re-add, repeat or reschedule those tasks unless the user asks. Never invent tasks, courses or deliverables the user did not mention." +
                      "\nThe earlier turns of this conversation are included before the user's latest message: use them to understand words like \"it\", \"them\" or \"that plan\". A turn starting with [Proposed plan] is a plan you suggested that the user has NOT applied yet, and one starting with [Applied plan] was already added to the task list; if they ask to change an unapplied plan, return the complete revised plan as one fresh JSON array (not just the differences). If they want to change tasks that are already in the task list above, return action=delete (with the taskId) for the old ones and action=add for the new ones." +
                      "\nFor every action=add item, \"description\" is one or two concrete sentences saying what to do, based on what the user said in this conversation. Never use generic filler." +
                      "\nWhen you return JSON, append one raw JSON array at the end of your response, formatted exactly like this:\n"
                    : "\n先判断用户想要什么，再回答：" +
                      "\n（A）用户在告知一个带时间的事件或安排（会议、上课、考试、约见、截止时间），例如“我明天晚上8点有个会”。就只记录这件事：用一句话确认，然后返回只含一个 add 条目的 JSON 数组。step 用用户自己的说法，suggestedDate 为用户说的确切时间（“明天”“周五”等请根据上面的当前时间推算），estimatedHours 为用户说的时长，没说就填 1。用户指定的时间不受下面的排期规则限制，晚上也一样。不要添加任何其他条目，也不要改动已有任务。如果用户没说具体时间，就询问时间，不返回 JSON。" +
                      "\n（B）用户请你制定计划、安排日程、拆解或排优先级。按排期规则做计划：所有 suggestedDate 必须在用户时区的 06:00 到 23:00 之间，不能与课程/不可用时间重叠；数据不足时默认优先 09:00-11:30、14:00-17:00、19:00-22:00。你可以增加计划，也可以删减/取消，删除旧任务请用 action=delete 并提供 taskId。" +
                      "\n（C）其他情况（提问、闲聊、道谢）：用纯文字简短回答，不要返回 JSON。" +
                      "\n上面的任务列表只是背景信息：除非用户要求，不要重复添加、重复安排或改期这些任务。不要编造用户没提到的任务、课程或作业。" +
                      "\n本次对话之前的几轮内容会放在用户最新消息之前：请用它们理解“它”“这些”“那个计划”等说法。以 [Proposed plan] 开头的是你之前给出、用户还没有应用的计划，以 [Applied plan] 开头的则已经加入了任务列表；如果用户要求修改还没应用的计划，请返回完整的新计划（一个全新的 JSON 数组，而不是只写改动的部分）。如果用户要改的是上面任务列表里已有的任务，请对旧任务返回 action=delete（带 taskId），对新安排返回 action=add。" +
                      "\n每个 action=add 的条目都必须有 \"description\"：用一两句具体的话说明要做什么，内容来自用户在本次对话中说的话，不要写空泛的套话。" +
                      "\n返回 JSON 时，请在回复最后附上一个纯 JSON 数组，格式严格如下：\n") +
                "[\n" +
                "  {\"action\": \"add\", \"step\": \"Task Name\", \"description\": \"What to do in this step\", \"estimatedHours\": 2, \"suggestedDate\": \"2026-04-14T10:00:00\"},\n" +
                "  {\"action\": \"delete\", \"taskId\": 12, \"step\": \"Old Task Name\", \"reason\": \"Conflict with sleep\"}\n" +
                "]\n" +
                "\n" + langInstruction; // 把语言强制指令放在最后，加重权重

        Map<String, Object> requestBody = Map.of(
                "model", model,
                "temperature", 0.3,
                "messages", buildMessages(systemPrompt, history, userMessage)
        );

        try {
            try {
                return postChat(requestBody);
            } catch (HttpClientErrorException.TooManyRequests limited) {
                // Free-tier limits are counted per model, so a second model has its own budget.
                if (fallbackModel == null || fallbackModel.isBlank() || fallbackModel.equals(model)) throw limited;
                System.err.println("AI rate limited on " + model + ", retrying with " + fallbackModel);
                Map<String, Object> retryBody = new java.util.HashMap<>(requestBody);
                retryBody.put("model", fallbackModel);
                return postChat(retryBody);
            }
        } catch (HttpClientErrorException.TooManyRequests e) {
            System.err.println("❌ AI 请求被限流: " + e.getMessage());
            return isEn ? "I'm getting a lot of requests right now. Please try again in a few seconds."
                        : "现在请求有点多，请几秒钟后再试一次。";
        } catch (Exception e) {
            System.err.println("❌ AI 请求失败: " + e.getMessage());
            // 🌟 7. 双语报错返回
            return isEn ? "Sorry, my brain is a bit scrambled right now (API Connection Failed)." : "对不起，我现在脑子有点乱（API连接失败）。";
        }
    }

    @SuppressWarnings("unchecked")
    private String postChat(Map<String, Object> requestBody) {
        Map<String, Object> response = restClient.post()
                .uri(apiUrl)
                .header(HttpHeaders.AUTHORIZATION, "Bearer " + apiKey)
                .contentType(MediaType.APPLICATION_JSON)
                .body(requestBody)
                .retrieve()
                .body(Map.class);

        List<Map<String, Object>> choices = (List<Map<String, Object>>) response.get("choices");
        Map<String, Object> message = (Map<String, Object>) choices.get(0).get("message");
        return (String) message.get("content");
    }
}
