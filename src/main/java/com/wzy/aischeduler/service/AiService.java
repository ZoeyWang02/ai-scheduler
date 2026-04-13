package com.wzy.aischeduler.service;

import com.wzy.aischeduler.entity.Task;
import com.wzy.aischeduler.repository.TaskRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;

import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

@Service
public class AiService {

    // 从 properties 文件里读取配置
    @Value("${llm.api.url}")
    private String apiUrl;

    @Value("${llm.api.key}")
    private String apiKey;

    @Value("${llm.model}")
    private String model;

    @Autowired
    private TaskRepository taskRepository; // 注入数据库操作类

    // Spring Boot 3 提供的新一代 HTTP 客户端
    private final RestClient restClient;

    public AiService() {
        this.restClient = RestClient.create();
    }

    /**
     * 核心方法：向大模型发送作业描述，获取拆解后的子任务
     */
    public String breakDownTask(String taskTitle, String taskDescription) {

        // 1. 🥇 提示词工程 (Prompt Engineering)
        String systemPrompt = "你是一个专业的常春藤名校学术时间管理专家。你的任务是帮学生把大型作业拆解成易于执行的子任务。请以纯 JSON 数组格式返回，不要包含任何额外的 Markdown 标记或闲聊。格式示例：[{\"step\": \"第一步名称\", \"estimatedHours\": 2}, ...]";
        String userPrompt = "请拆解这个作业。标题：[" + taskTitle + "]。详细描述：[" + taskDescription + "]";

        // 2. 📦 组装发送给 LLM 的数据包 (严格按照 API 规范)
        Map<String, Object> requestBody = Map.of(
                "model", model,
                "temperature", 0.3, // 0.3 代表让 AI 保持理智和严谨，不要瞎编
                "messages", List.of(
                        Map.of("role", "system", "content", systemPrompt),
                        Map.of("role", "user", "content", userPrompt)
                )
        );

        // 3. 🚀 发射请求并接收响应
        System.out.println("🤖 正在呼叫 AI 大脑，请稍候...");
        try {
            // 这里会向 AI 发起真正的网络请求
            Map<String, Object> response = restClient.post()
                    .uri(apiUrl)
                    .header(HttpHeaders.AUTHORIZATION, "Bearer " + apiKey)
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(requestBody)
                    .retrieve()
                    .body(Map.class); // 将 AI 返回的复杂 JSON 转换成 Java Map

            // 4. 🧲 像剥洋葱一样提取出 AI 说的具体内容
            List<Map<String, Object>> choices = (List<Map<String, Object>>) response.get("choices");
            Map<String, Object> message = (Map<String, Object>) choices.get(0).get("message");
            return (String) message.get("content");

        } catch (Exception e) {
            System.err.println("❌ AI 请求失败: " + e.getMessage());
            return "[]";
        }
    }



    /**
     * 自由聊天方法
     */
    public String chat(String userMessage) {
        // 1. 从数据库读取前 20 条任务作为“记忆”
        List<Task> tasks = taskRepository.findAll();
        String taskContext = tasks.stream()
                .map(t -> "- " + t.getTitle() + " (截止日期: " + t.getDueDate() + ")")
                .collect(Collectors.joining("\n"));

        String currentTime = LocalDateTime.now().format(DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss"));

        String systemPrompt = "你是一个UIUC的学术助理。以下是用户的课程作业：\n" + taskContext +
                "\n\n现在的时间是：" + currentTime + "。" +
                "\n请回答用户问题。如果用户要求拆解作业或制定计划，你必须在回复最后提供一个纯 JSON 数组，格式严格如下：\n" +
                "[\n" +
                "  {\"step\": \"第一步任务名称\", \"estimatedHours\": 2, \"suggestedDate\": \"2026-04-14T10:00:00\"},\n" +
                "  {\"step\": \"第二步任务名称\", \"estimatedHours\": 3, \"suggestedDate\": \"2026-04-15T14:00:00\"}\n" +
                "]\n" +
                "注意：suggestedDate 必须是你结合当前时间和截止日期，推荐用户去做的具体时间（ISO 8601 格式）。" +
                "如果是普通的闲聊，则正常回答文本即可。";
        // 2. 组装数据包 (注意这里把用户的 userMessage 塞进去了)
        Map<String, Object> requestBody = Map.of(
                "model", model,
                "temperature", 0.7, // 聊天可以稍微发散一点，设为 0.7
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
            return "对不起，我现在脑子有点乱（API连接失败）。";
        }
    }
}