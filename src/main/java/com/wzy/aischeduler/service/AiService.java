package com.wzy.aischeduler.service;

import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
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
     * 核心双语聊天方法
     */
    public String chat(String userMessage, Long userId, String userTimezone, String lang) {
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
                (isEn 
                    ? "\nScheduling rules: All suggestedDate must be between 06:00 and 23:00 (user's local time). Do not overlap with busy times. If not enough data, prioritize 09:00-11:30, 14:00-17:00, 19:00-22:00." +
                      "\nYou can add, reduce, or cancel tasks. To delete an existing task, return action=delete and provide the taskId." +
                      "\nIf the user asks for a plan, append a raw JSON array at the end of your response, formatted exactly like this:\n"
                    : "\n排期硬性规则：所有 suggestedDate 必须在用户选择时区的时间 06:00 到 23:00 之间；不能安排在课程时间内；如果没有足够数据，默认优先 09:00-11:30、14:00-17:00、19:00-22:00。" +
                      "\n你可以增加计划，也可以删减/取消。删除旧任务请用 action=delete 并提供 taskId。" +
                      "\n如果用户要求制定计划，请在回复最后提供一个纯 JSON 数组，格式严格如下：\n") +
                "[\n" +
                "  {\"action\": \"add\", \"step\": \"Task Name\", \"estimatedHours\": 2, \"suggestedDate\": \"2026-04-14T10:00:00\"},\n" +
                "  {\"action\": \"delete\", \"taskId\": 12, \"step\": \"Old Task Name\", \"reason\": \"Conflict with sleep\"}\n" +
                "]\n" +
                "\n" + langInstruction; // 把语言强制指令放在最后，加重权重

        Map<String, Object> requestBody = Map.of(
                "model", model,
                "temperature", 0.7,
                "messages", List.of(
                        Map.of("role", "system", "content", systemPrompt),
                        Map.of("role", "user", "content", userMessage)
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
            // 🌟 7. 双语报错返回
            return isEn ? "Sorry, my brain is a bit scrambled right now (API Connection Failed)." : "对不起，我现在脑子有点乱（API连接失败）。";
        }
    }
}
