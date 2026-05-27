package com.wzy.aischeduler.controller;

import java.time.ZoneId;
import java.util.List;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/timezones")
public class TimezoneController {

    @GetMapping
    public List<String> getTimezones() {
        return ZoneId.getAvailableZoneIds().stream()
                // 🌟 核心过滤逻辑：
                // 1. 必须包含 "/" (确保是 大洲/城市 格式)
                // 2. 排除 "Etc/" 开头的固定偏移量时区 (如 Etc/GMT+8)
                // 3. 排除 "SystemV/" 等过时的操作系统级时区
                .filter(zone -> zone.contains("/") 
                             && !zone.startsWith("Etc/") 
                             && !zone.startsWith("SystemV/") 
                             && !zone.startsWith("US/"))
                .sorted() // 按字母顺序 A-Z 排序
                .toList();
    }
}
