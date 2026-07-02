package com.wzy.aischeduler.service;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

import org.springframework.stereotype.Service;

import com.wzy.aischeduler.dto.CourseEventDTO;
import com.wzy.aischeduler.entity.CourseEvent;
import com.wzy.aischeduler.entity.User;
import com.wzy.aischeduler.repository.CourseEventRepository;
import com.wzy.aischeduler.repository.UserRepository;

@Service
public class CourseEventService {

    private final CourseEventRepository courseEventRepository;
    private final UserRepository userRepository;

    public CourseEventService(CourseEventRepository courseEventRepository, UserRepository userRepository) {
        this.courseEventRepository = courseEventRepository;
        this.userRepository = userRepository;
    }

    public int importIcs(InputStream inputStream, Long userId, String timezone) {
        User user = userRepository.findById(userId)
                // 🌟 双语抛出异常，前端可以按需提示
                .orElseThrow(() -> new IllegalArgumentException("当前登录用户不存在 / User does not exist, please sign in again."));
        ZoneId zoneId = ZoneId.of(timezone);
        List<CourseEvent> events = parseEvents(inputStream, zoneId);
        events.forEach(event -> event.setUser(user));
        courseEventRepository.saveAll(events);
        return events.size();
    }

    public List<CourseEventDTO> getEvents(Long userId, String timezone) {
        if (userId == null) {
            return List.of();
        }
        ZoneId zoneId = ZoneId.of(timezone);
        return courseEventRepository.findByUserId(userId).stream()
                .map(event -> toDto(event, zoneId))
                .toList();
    }

    // 🌟 为了兼容之前 AiService.java 没有传 lang 参数的调用，保留重载方法
    public String buildBusyContext(Long userId, String timezone) {
        return buildBusyContext(userId, timezone, "zh");
    }

    // 🌟 核心双语化：喂给 AI 的繁忙上下文也要根据语言动态变化
    public String buildBusyContext(Long userId, String timezone, String lang) {
        boolean isEn = "en".equals(lang);
        String noData = isEn ? "No course schedule data available." : "暂无课程表数据。";
        
        if (userId == null) return noData;
        
        ZoneId zoneId = ZoneId.of(timezone);
        LocalDateTime start = ZonedDateTime.now(ZoneId.of(timezone))
                .withZoneSameInstant(ZoneId.of("UTC"))
                .toLocalDateTime();
        LocalDateTime end = start.plusDays(14);
        List<CourseEvent> events = courseEventRepository.findByUserIdAndStartTimeBetween(userId, start, end);
        
        if (events.isEmpty()) return noData;
        
        return events.stream()
                .map(event -> event.getTitle() + ": "
                        + event.getStartTime().atZone(ZoneId.of("UTC")).withZoneSameInstant(zoneId).format(DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm"))
                        + " - "
                        + event.getEndTime().atZone(ZoneId.of("UTC")).withZoneSameInstant(zoneId).format(DateTimeFormatter.ofPattern("HH:mm")))
                .reduce((a, b) -> a + "\n" + b)
                .orElse(noData);
    }

    private CourseEventDTO toDto(CourseEvent event, ZoneId zoneId) {
        CourseEventDTO dto = new CourseEventDTO();
        dto.setId(event.getId());
        dto.setTitle(event.getTitle());
        dto.setStart(event.getStartTime().atZone(ZoneId.of("UTC")).withZoneSameInstant(zoneId).toLocalDateTime().toString());
        dto.setEnd(event.getEndTime().atZone(ZoneId.of("UTC")).withZoneSameInstant(zoneId).toLocalDateTime().toString());
        dto.setLocation(event.getLocation());
        return dto;
    }

    public List<CourseEvent> parseEvents(InputStream inputStream, ZoneId defaultZone) {
        List<CourseEvent> events = new ArrayList<>();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(inputStream, StandardCharsets.UTF_8))) {
            Map<String, String> current = null;
            String line;
            while ((line = reader.readLine()) != null) {
                if ("BEGIN:VEVENT".equals(line)) {
                    current = new TreeMap<>();
                    continue;
                }
                if ("END:VEVENT".equals(line)) {
                    if (current != null) {
                        // 🌟 现在 toEvents 返回的是一个“展开后的课程列表”，直接全部添加
                        events.addAll(toEvents(current, defaultZone));
                    }
                    current = null;
                    continue;
                }
                if (current != null && line.contains(":")) {
                    int split = line.indexOf(':');
                    String key = line.substring(0, split);
                    String value = line.substring(split + 1);
                    current.put(key, value);
                }
            }
        } catch (Exception e) {
            throw new IllegalArgumentException("ICS 解析失败 / ICS Parsing failed: " + e.getMessage());
        }
        return events;
    }

    // 🌟 修改：支持将单节课和循环规则，展开成一整个学期的课程集合
    private List<CourseEvent> toEvents(Map<String, String> raw, ZoneId defaultZone) {
        String summary = firstValue(raw, "SUMMARY");
        String location = firstValue(raw, "LOCATION");
        LocalDateTime startUtc = parseIcsTime(raw, "DTSTART", defaultZone);
        LocalDateTime endUtc = parseIcsTime(raw, "DTEND", defaultZone);
        
        if (startUtc == null || endUtc == null) {
            return List.of();
        }

        String title = summary == null || summary.isBlank() ? "Course" : summary;
        String rrule = firstValue(raw, "RRULE");

        // 如果没有循环规则，这节课就是一次性的
        if (rrule == null || rrule.isBlank()) {
            CourseEvent event = new CourseEvent();
            event.setTitle(title);
            event.setLocation(location);
            event.setStartTime(startUtc);
            event.setEndTime(endUtc);
            return List.of(event);
        }

        // 🌟 核心：如果有 RRULE，交由强大的循环展开器处理
        return expandRRule(title, location, startUtc, endUtc, rrule, defaultZone);
    }

    // 🌟 全新核弹级方法：解析 RRULE 循环，并完美抗击美国夏令时切换
    private List<CourseEvent> expandRRule(String title, String location, LocalDateTime startUtc, LocalDateTime endUtc, String rrule, ZoneId defaultZone) {
        List<CourseEvent> expanded = new ArrayList<>();
        Map<String, String> rules = new HashMap<>();
        
        for (String part : rrule.split(";")) {
            String[] kv = part.split("=");
            if (kv.length == 2) rules.put(kv[0], kv[1]);
        }

        if (!"WEEKLY".equals(rules.get("FREQ"))) {
            // 目前主要处理大学最常见的每周重复排课 (Weekly)
            CourseEvent event = new CourseEvent();
            event.setTitle(title);
            event.setLocation(location);
            event.setStartTime(startUtc);
            event.setEndTime(endUtc);
            return List.of(event);
        }

        // 提取结束边界 UNTIL
        LocalDateTime untilUtc = startUtc.plusMonths(6); // 默认保护机制：最多排半年的课
        if (rules.containsKey("UNTIL")) {
            String untilStr = rules.get("UNTIL");
            try {
                if (untilStr.length() == 8) { // 例如 UNTIL=20260506
                    untilUtc = LocalDate.parse(untilStr, DateTimeFormatter.ofPattern("yyyyMMdd"))
                            .atTime(23, 59, 59).atZone(defaultZone).withZoneSameInstant(ZoneId.of("UTC")).toLocalDateTime();
                } else if (untilStr.endsWith("Z")) { // 例如 UNTIL=20260506T225900Z
                    untilUtc = ZonedDateTime.parse(untilStr, DateTimeFormatter.ofPattern("yyyyMMdd'T'HHmmssX"))
                            .withZoneSameInstant(ZoneId.of("UTC")).toLocalDateTime();
                } else {
                    untilUtc = LocalDateTime.parse(untilStr, DateTimeFormatter.ofPattern("yyyyMMdd'T'HHmmss"))
                            .atZone(defaultZone).withZoneSameInstant(ZoneId.of("UTC")).toLocalDateTime();
                }
            } catch (Exception e) {
                System.err.println("Failed to parse UNTIL: " + untilStr);
            }
        }

        // 提取每周上课的是哪几天 (BYDAY)
        List<DayOfWeek> byDays = new ArrayList<>();
        if (rules.containsKey("BYDAY")) {
            for (String d : rules.get("BYDAY").split(",")) {
                switch (d.trim()) {
                    case "MO": byDays.add(DayOfWeek.MONDAY); break;
                    case "TU": byDays.add(DayOfWeek.TUESDAY); break;
                    case "WE": byDays.add(DayOfWeek.WEDNESDAY); break;
                    case "TH": byDays.add(DayOfWeek.THURSDAY); break;
                    case "FR": byDays.add(DayOfWeek.FRIDAY); break;
                    case "SA": byDays.add(DayOfWeek.SATURDAY); break;
                    case "SU": byDays.add(DayOfWeek.SUNDAY); break;
                }
            }
        } else {
            // 如果没写，默认就是开学那天的星期几
            byDays.add(startUtc.atZone(ZoneId.of("UTC")).withZoneSameInstant(defaultZone).getDayOfWeek());
        }

        // 🌟 解决夏令时切换的绝杀：将底层 UTC 转为具体的地区时间 (ZonedDateTime) 去做递增
        ZonedDateTime currentLocalStart = startUtc.atZone(ZoneId.of("UTC")).withZoneSameInstant(defaultZone);
        ZonedDateTime currentLocalEnd = endUtc.atZone(ZoneId.of("UTC")).withZoneSameInstant(defaultZone);
        
        int maxOccurrences = 150; // 防止无限死循环的熔断机制
        int count = 0;

        // 一天一天地往后推进，遇到符合的星期几就生成一节课
        while (!currentLocalStart.withZoneSameInstant(ZoneId.of("UTC")).toLocalDateTime().isAfter(untilUtc) && count < maxOccurrences) {
            if (byDays.contains(currentLocalStart.getDayOfWeek())) {
                CourseEvent event = new CourseEvent();
                event.setTitle(title);
                event.setLocation(location);
                // 存入数据库前，再安全地剥离回纯净的 UTC 架构
                event.setStartTime(currentLocalStart.withZoneSameInstant(ZoneId.of("UTC")).toLocalDateTime());
                event.setEndTime(currentLocalEnd.withZoneSameInstant(ZoneId.of("UTC")).toLocalDateTime());
                expanded.add(event);
                count++;
            }
            // 每天推进一步：在这个时区内+1天（即使穿过夏令时，由于是按当前时区推进的，上课时间依然会稳如泰山）
            currentLocalStart = currentLocalStart.plusDays(1);
            currentLocalEnd = currentLocalEnd.plusDays(1);
        }

        // 兜底：如果 BYDAY 匹配规则有误，至少要把第一节课加进去
        if (expanded.isEmpty()) {
            CourseEvent event = new CourseEvent();
            event.setTitle(title);
            event.setLocation(location);
            event.setStartTime(startUtc);
            event.setEndTime(endUtc);
            expanded.add(event);
        }

        return expanded;
    }

    private String firstValue(Map<String, String> raw, String prefix) {
        return raw.entrySet().stream()
                .filter(entry -> entry.getKey().equals(prefix) || entry.getKey().startsWith(prefix + ";"))
                .map(Map.Entry::getValue)
                .findFirst()
                .orElse(null);
    }

    private LocalDateTime parseIcsTime(Map<String, String> raw, String prefix, ZoneId defaultZone) {
        Map.Entry<String, String> entry = raw.entrySet().stream()
                .filter(item -> item.getKey().equals(prefix) || item.getKey().startsWith(prefix + ";"))
                .findFirst()
                .orElse(null);
        if (entry == null) {
            return null;
        }
        String value = entry.getValue();
        ZoneId zone = defaultZone;
        String key = entry.getKey();
        int tzIndex = key.indexOf("TZID=");
        if (tzIndex >= 0) {
            String zoneText = key.substring(tzIndex + 5).split(";")[0];
            zone = ZoneId.of(zoneText);
        }
        DateTimeFormatter formatter = DateTimeFormatter.ofPattern("yyyyMMdd'T'HHmmss");
        if (value.endsWith("Z")) {
            return ZonedDateTime.parse(value, DateTimeFormatter.ofPattern("yyyyMMdd'T'HHmmssX"))
                    .withZoneSameInstant(ZoneId.of("UTC"))
                    .toLocalDateTime();
        }
        return LocalDateTime.parse(value, formatter)
                .atZone(zone)
                .withZoneSameInstant(ZoneId.of("UTC"))
                .toLocalDateTime();
    }

    public void deleteEvent(Long id) {
        if (!courseEventRepository.existsById(id)) {
            throw new IllegalArgumentException("未找到指定的课程 / Course not found, ID: " + id);
        }
        courseEventRepository.deleteById(id);
    }
}
