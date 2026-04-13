package com.wzy.aischeduler.controller;

import com.wzy.aischeduler.service.AiService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

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
    public String chatWithAi(@RequestBody Map<String, String> requestData) {
        // 从传进来的 JSON 数据包中，提取键名为 "message" 的值
        String userMessage = requestData.get("message");

        // 如果前端发来的消息为空，给个友好的提示，防止程序报错
        if (userMessage == null || userMessage.trim().isEmpty()) {
            return "提示：请在请求包中包含 'message' 字段。";
        }

        // 调用 AiService 的聊天方法，并把 AI 的回答返回出去
        return aiService.chat(userMessage);
    }
}