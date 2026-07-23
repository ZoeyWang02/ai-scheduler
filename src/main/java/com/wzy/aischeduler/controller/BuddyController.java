package com.wzy.aischeduler.controller;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.wzy.aischeduler.dto.BuddyStateDTO;
import com.wzy.aischeduler.service.AuthService;
import com.wzy.aischeduler.service.BuddyStateService;

@RestController
@RequestMapping("/api/buddy")
public class BuddyController {

    private final BuddyStateService buddyStateService;
    private final AuthService authService;

    public BuddyController(BuddyStateService buddyStateService, AuthService authService) {
        this.buddyStateService = buddyStateService;
        this.authService = authService;
    }

    /**
     * 当前 Study Buddy 状态快照，供前端在页面加载 / 打开设置时拉取。
     * 响应结构：
     * {
     *   "buddyId": "junimo",
     *   "stage": "growing",
     *   "xp": 134,
     *   "level": 3,
     *   "xpIntoLevel": 34,
     *   "xpPerLevel": 50,
     *   "xpToNextStage": 166,
     *   "totalTasksCompleted": 12,
     *   "earlyCompletions": 5,
     *   "mood": "calm",
     *   "justLeveledUp": null,
     *   "justAdvancedStage": null
     * }
     */
    @GetMapping("/state")
    public ResponseEntity<?> getState(@RequestParam Long userId, @RequestParam String authToken) {
        try {
            authService.requireUser(userId, authToken);
            BuddyStateDTO state = buddyStateService.getState(userId);
            return ResponseEntity.ok(state);
        } catch (SecurityException e) {
            return ResponseEntity.status(401).body(e.getMessage());
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(e.getMessage());
        }
    }
}
