package com.wzy.aischeduler.controller;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDateTime;
import java.util.HashMap;
import java.util.Map;

// 1. 告诉 Spring 这是一个对外暴露的 Web 接口类
@RestController
// 2. 规定这个类里所有接口的“基础网址”
@RequestMapping("/api/test")
public class TestController {

    // 3. 规定这个具体方法的路径。当浏览器发起 GET 请求时触发
    @GetMapping("/ping")
    public String ping() {
        return "Pong! 🏓 恭喜你，Spring Boot 服务器运行正常！";
    }

    // 4. 面试加分项：返回一个标准的 JSON 格式
    @GetMapping("/status")
    public Map<String, Object> getServerStatus() {
        Map<String, Object> status = new HashMap<>();
        status.put("status", "UP");
        status.put("developer", "Zhongyin Wang");
        status.put("serverTime", LocalDateTime.now().toString());
        return status; // Spring Boot 会自动把 Map 转换成漂亮的 JSON 返回给浏览器
    }
}