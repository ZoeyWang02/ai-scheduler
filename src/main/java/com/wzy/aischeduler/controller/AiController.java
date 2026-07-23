package com.wzy.aischeduler.controller;

import java.util.Map;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.wzy.aischeduler.service.AiService;
import com.wzy.aischeduler.service.AuthService;

@RestController
@RequestMapping("/api/ai")
public class AiController {
    private final AiService aiService;
    private final AuthService authService;

    public AiController(AiService aiService, AuthService authService) {
        this.aiService = aiService;
        this.authService = authService;
    }

    @GetMapping("/test")
    public String testAi() {
        String title = "Grant Proposal Final Draft";
        String desc = "Write a 5000-word grant proposal for a new AI research lab. Include budget, timeline, and impact assessment. Must use APA format.";
        return aiService.breakDownTask(title, desc);
    }

    @GetMapping("/status")
    public Map<String, Boolean> status() {
        return Map.of("configured", aiService.isConfigured());
    }

    @PostMapping("/translate")
    public ResponseEntity<?> translate(@RequestBody Map<String, String> requestData) {
        String text = requestData.get("text");
        String targetLang = requestData.getOrDefault("targetLang", "en");
        String authToken = requestData.get("authToken");
        if (text == null || text.isBlank()) {
            return ResponseEntity.badRequest().body("Request must include a non-empty 'text' field.");
        }
        try {
            authService.requireToken(authToken);
            return ResponseEntity.ok(Map.of("translated", aiService.translateText(text, targetLang)));
        } catch (SecurityException e) {
            return ResponseEntity.status(401).body("Authentication failed: " + e.getMessage());
        } catch (Exception e) {
            return ResponseEntity.internalServerError().body("Translation failed: " + e.getMessage());
        }
    }

    @PostMapping("/chat")
    public ResponseEntity<String> chatWithAi(@RequestBody Map<String, String> requestData) {
        String userMessage = requestData.get("message");
        if (userMessage == null || userMessage.trim().isEmpty()) {
            return ResponseEntity.badRequest().body("Request must include a non-empty 'message' field.");
        }

        Long userId = null;
        if (requestData.get("userId") != null && !requestData.get("userId").isBlank()) {
            userId = Long.parseLong(requestData.get("userId"));
        }
        String authToken = requestData.get("authToken");
        String timezone = requestData.getOrDefault("timezone", "America/Chicago");
        String lang = requestData.getOrDefault("lang", "en");

        try {
            if (userId != null) {
                authService.requireUser(userId, authToken);
            }
            return ResponseEntity.ok(aiService.chat(userMessage, userId, timezone, lang));
        } catch (SecurityException e) {
            return ResponseEntity.status(401).body("Authentication failed: " + e.getMessage());
        } catch (Exception e) {
            return ResponseEntity.internalServerError().body("AI service error: " + e.getMessage());
        }
    }
}
