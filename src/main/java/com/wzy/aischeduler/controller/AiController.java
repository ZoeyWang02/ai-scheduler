package com.wzy.aischeduler.controller;

import java.util.Map;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.wzy.aischeduler.service.AiService;

@RestController
@RequestMapping("/api/ai")
public class AiController {

    @Autowired
    private AiService aiService;

    /**
     * 1. 静态测试接口 (GET 请求)dd
     * 可以在浏览器地址栏直接访问：http://localhost:8081/api/ai/test
     * 作用：测试 API Key 是否配置正确，网络是否畅通。
     */
    @GetMapping("/test")
    public String testAi() {
        String title = "Grant Proposal Final Draft";
        String desc = "Write a 5000-word grant proposal for a new AI research lab. Include budget, timeline, and impact assessment. Must use APA format.";

        // 调用 AiService 的任务拆解方法
        return aiService.breakDownTask(title, desc);
    }

    /**
     * 2. 动态聊天接口 (POST 请求)
     * 不能在浏览器地址栏直接访问，必须通过 Postman 或 .http 文件发送 JSON 数据。
     * 作用：接收前端或用户发送的动态消息，并返回 AI 的回答。
     */
    @PostMapping("/chat")
    // 🌟 1. 修改返回值类型为 ResponseEntity<String>
    public ResponseEntity<String> chatWithAi(@RequestBody Map<String, String> requestData) {
        // 从传进来的 JSON 数据包中，提取键名为 "message" 的值
        String userMessage = requestData.get("message");
        Long userId = null;
        if (requestData.get("userId") != null && !requestData.get("userId").isBlank()) {
            userId = Long.parseLong(requestData.get("userId"));
        }
        String timezone = requestData.getOrDefault("timezone", "America/Chicago");
        String lang = requestData.getOrDefault("lang", "en");

        // 如果前端发来的消息为空，给个友好的提示，防止程序报错
        if (userMessage == null || userMessage.trim().isEmpty()) {
            // 🌟 2. 这里的返回也要包一层 ResponseEntity (返回 400 Bad Request)
            return ResponseEntity.badRequest().body("提示：请在请求包中包含 'message' 字段。");
        }

        try {
            // 将 lang 参数传递给 AiService (你需要同步修改 AiService.java 的方法签名)
            String response = aiService.chat(userMessage, userId, timezone, lang);
            return ResponseEntity.ok(response); // 这里就不会报错了
        } catch (Exception e) {
            return ResponseEntity.internalServerError().body("AI 服务异常: " + e.getMessage()); // 这里也不会报错了
        }
    }

    
}
