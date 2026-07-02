package com.wzy.aischeduler.controller;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.wzy.aischeduler.dto.LifestyleAnalysisDTO;
import com.wzy.aischeduler.service.AuthService;
import com.wzy.aischeduler.service.LifestyleAnalysisService;

@RestController
@RequestMapping("/api/analytics")
public class AnalyticsController {

    @Autowired
    private LifestyleAnalysisService lifestyleAnalysisService;

    @Autowired
    private AuthService authService;

    @GetMapping("/lifestyle")
    public LifestyleAnalysisDTO getLifestyleAnalysis(
            @RequestParam(defaultValue = "week") String period,
            @RequestParam(defaultValue = "America/Chicago") String timezone,
            @RequestParam(required = false) Long userId,
            @RequestParam(required = false) String authToken,
            @RequestParam(defaultValue = "en") String lang){
        if (userId != null) {
            authService.requireUser(userId, authToken);
        }
        return lifestyleAnalysisService.analyze(period, timezone, userId, lang);
    }
}
