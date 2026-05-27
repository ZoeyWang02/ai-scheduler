package com.wzy.aischeduler.service;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import com.wzy.aischeduler.dto.LifestyleAnalysisDTO;
import com.wzy.aischeduler.dto.LifestyleAnalysisDTO.HourlyStudyDTO;
import com.wzy.aischeduler.dto.LifestyleAnalysisDTO.TimeBucketDTO;
import com.wzy.aischeduler.entity.Task;
import com.wzy.aischeduler.repository.TaskRepository;

@Service
public class LifestyleAnalysisService {

    @Autowired
    private TaskRepository taskRepository;

    private static final Pattern HOURS_PATTERN = Pattern.compile("(预计耗时|预计时长|estimated|耗时)\\s*[:：]?\\s*(\\d+(?:\\.\\d+)?)");

    // 🌟 增加 lang 参数
    public LifestyleAnalysisDTO analyze(String period, String userTimezone, String lang) {
        return analyze(period, userTimezone, null, lang);
    }

    // 🌟 增加 lang 参数
    public LifestyleAnalysisDTO analyze(String period, String userTimezone, Long userId, String lang) {
        String normalizedPeriod = normalizePeriod(period);
        ZoneId zoneId = ZoneId.of(userTimezone);
        LocalDateTime start = getStartTime(normalizedPeriod, zoneId);

        List<Task> sourceTasks = userId == null ? List.of() : taskRepository.findByUserId(userId);
        List<Task> tasks = sourceTasks.stream()
                .filter(task -> task.getDueDate() != null)
                .filter(task -> !task.getDueDate().isBefore(start))
                .sorted(Comparator.comparing(Task::getDueDate))
                .toList();

        int[] buckets = new int[4];
        double[] hourlyHours = new double[24];
        int completedCount = 0;
        for (Task task : tasks) {
            if (task.getDueDate() != null) {
                java.time.ZoneId serverZone = java.time.ZoneId.systemDefault();
                java.time.ZonedDateTime userTime = task.getDueDate()
                    .atZone(serverZone)
                    .withZoneSameInstant(zoneId); 
                
                int hour = userTime.getHour();
                buckets[bucketIndex(hour)]++;
                hourlyHours[hour] += estimateHours(task);
                if (task.isCompleted()) {
                    completedCount++;
                }
            }
        }

        LifestyleAnalysisDTO dto = new LifestyleAnalysisDTO();
        dto.setPeriod(normalizedPeriod);
        dto.setTotalTasks(tasks.size());
        dto.setCompletedTasks(completedCount);
        
        // 🌟 传递 lang 参数
        dto.setTimeBuckets(toBucketDtos(buckets, tasks.size(), lang));
        dto.setHourlyStudy(toHourlyDtos(hourlyHours));

        boolean isEn = "en".equals(lang);

        if (tasks.isEmpty()) {
            dto.setPeakWindow(isEn ? "No Data" : "暂无数据");
            dto.setRhythmLabel(isEn ? "Waiting for data" : "等待数据");
            dto.setFocusStyle(isEn ? "Waiting for data" : "等待数据");
            dto.setRecommendation(buildRecommendation(dto, lang));
            return dto;
        }

        int strongestBucket = strongestBucketIndex(buckets);
        dto.setPeakWindow(bucketLabel(strongestBucket, lang));
        dto.setRhythmLabel(rhythmLabel(strongestBucket, lang));
        dto.setFocusStyle(inferFocusStyle(tasks.size(), normalizedPeriod, strongestBucket, lang));
        dto.setRecommendation(buildRecommendation(dto, lang));
        return dto;
    }

    private String normalizePeriod(String period) {
        if ("day".equalsIgnoreCase(period) || "month".equalsIgnoreCase(period)) {
            return period.toLowerCase();
        }
        return "week";
    }

    private LocalDateTime getStartTime(String period, ZoneId zoneId) {
        LocalDate today = LocalDate.now(zoneId);
        return switch (period) {
            case "day" -> today.atStartOfDay();
            case "month" -> today.minusDays(30).atStartOfDay();
            default -> today.minusDays(7).atStartOfDay();
        };
    }

    private int bucketIndex(int hour) {
        if (hour >= 5 && hour < 12) return 0;
        if (hour >= 12 && hour < 17) return 1;
        if (hour >= 17 && hour < 23) return 2;
        return 3;
    }

    // 🌟 传递 lang 参数
    private List<TimeBucketDTO> toBucketDtos(int[] buckets, int total, String lang) {
        List<TimeBucketDTO> result = new ArrayList<>();
        for (int i = 0; i < buckets.length; i++) {
            int percentage = total == 0 ? 0 : Math.round((buckets[i] * 100f) / total);
            result.add(new TimeBucketDTO(bucketLabel(i, lang), buckets[i], percentage));
        }
        return result;
    }

    private List<HourlyStudyDTO> toHourlyDtos(double[] hourlyHours) {
        List<HourlyStudyDTO> result = new ArrayList<>();
        for (int hour = 0; hour < hourlyHours.length; hour++) {
            double rounded = Math.round(hourlyHours[hour] * 10.0) / 10.0;
            result.add(new HourlyStudyDTO(hour, rounded));
        }
        return result;
    }

    private double estimateHours(Task task) {
        String description = task.getDescription();
        if (description != null) {
            Matcher matcher = HOURS_PATTERN.matcher(description);
            if (matcher.find()) {
                return Double.parseDouble(matcher.group(2));
            }
        }
        return 1.0;
    }

    private int strongestBucketIndex(int[] buckets) {
        int maxIndex = 0;
        for (int i = 1; i < buckets.length; i++) {
            if (buckets[i] > buckets[maxIndex]) {
                maxIndex = i;
            }
        }
        return maxIndex;
    }

    // 🌟 双语化标签
    private String bucketLabel(int index, String lang) {
        boolean isEn = "en".equals(lang);
        return switch (index) {
            case 0 -> isEn ? "Morning 5-12" : "早晨 5-12";
            case 1 -> isEn ? "Afternoon 12-17" : "下午 12-17";
            case 2 -> isEn ? "Evening 17-23" : "晚上 17-23";
            default -> isEn ? "Late Night 23-5" : "深夜 23-5";
        };
    }

    // 🌟 双语化标签
    private String rhythmLabel(int index, String lang) {
        boolean isEn = "en".equals(lang);
        return switch (index) {
            case 0 -> isEn ? "Morning Bird" : "晨间学习者";
            case 1 -> isEn ? "Afternoon Pusher" : "午后推进型";
            case 2 -> isEn ? "Night Owl" : "夜间高能型";
            default -> isEn ? "Midnight Sprinter" : "深夜冲刺型";
        };
    }

    // 🌟 双语化标签
    private String inferFocusStyle(int taskCount, String period, int strongestBucket, String lang) {
        boolean isEn = "en".equals(lang);
        int density = switch (period) {
            case "day" -> taskCount;
            case "month" -> Math.round(taskCount / 4f);
            default -> taskCount;
        };

        if (density >= 8) {
            return isEn ? "Fragmented Focus" : "碎片化专注";
        }
        if (strongestBucket == 2 || strongestBucket == 3) {
            return isEn ? "Deep Block Focus" : "长时间深度专注";
        }
        return isEn ? "Steady Rhythm" : "稳定节奏型";
    }

    // 🌟 双语化建议
    private String buildRecommendation(LifestyleAnalysisDTO dto, String lang) {
        boolean isEn = "en".equals(lang);
        
        if (dto.getTotalTasks() == 0) {
            return isEn ? "Not enough historical data. Import Canvas or Coursera tasks first, and I will update your rhythm profile." 
                        : "还没有足够历史数据。先导入 Canvas 或 Coursera 任务，我会根据截止时间和完成记录更新你的节奏画像。";
        }

        // 注意：因为上面把 dto 存进去的可能是英文，也可能是中文，我们直接根据属性判断或者用 isEn 判断都可以
        String style = dto.getFocusStyle();
        if ("碎片化专注".equals(style) || "Fragmented Focus".equals(style)) {
            return isEn ? "Suggest breaking high-pressure tasks into 25-40 min chunks, and place review tasks in between breaks." 
                        : "建议把高压任务拆成 25-40 分钟小块，并把复习、阅读类任务放进课间或饭后空档。";
        }

        if ("长块深度专注".equals(style) || "Deep Block Focus".equals(style)) {
            return isEn ? "Suggest keeping 1-2 deep learning blocks (90 mins) daily. Prioritize complex tasks during your peak hours." 
                        : "建议每天保留 1-2 个 90 分钟深度学习块，复杂作业优先放在你的高能时段。";
        }

        return isEn ? "Maintain a steady learning window. Lock in your top 3 tasks a day in advance to avoid rushing." 
                    : "建议维持固定学习窗口，提前一天锁定最重要的 3 个任务，减少临时赶工。";
    }
}