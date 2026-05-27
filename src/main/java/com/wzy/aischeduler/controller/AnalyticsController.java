package com.wzy.aischeduler.controller;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.wzy.aischeduler.dto.LifestyleAnalysisDTO;
import com.wzy.aischeduler.service.LifestyleAnalysisService;

@RestController
@RequestMapping("/api/analytics")
public class AnalyticsController {

    @Autowired
    private LifestyleAnalysisService lifestyleAnalysisService;

    @GetMapping("/lifestyle")
    public LifestyleAnalysisDTO getLifestyleAnalysis(
            @RequestParam(defaultValue = "week") String period,
            @RequestParam(defaultValue = "America/Chicago") String timezone,
            @RequestParam(required = false) Long userId,
            @RequestParam(defaultValue = "en") String lang){
        return lifestyleAnalysisService.analyze(period, timezone, userId, lang);
    }
}
