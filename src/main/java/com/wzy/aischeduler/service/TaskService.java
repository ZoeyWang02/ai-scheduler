package com.wzy.aischeduler.service;

import com.wzy.aischeduler.dto.TaskResponseDTO;
import com.wzy.aischeduler.entity.Task;
import com.wzy.aischeduler.repository.TaskRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.stream.Collectors;

@Service
public class TaskService {

    @Autowired
    private TaskRepository taskRepository;

    // 预设一个日期格式，让前端显示的更美观
    private static final DateTimeFormatter FORMATTER = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm");

    public List<TaskResponseDTO> getAllTasksForUser(String userTimezone) {
        // 1. 从数据库拿到原始的 Task 列表
        List<Task> tasks = taskRepository.findAll();

        // 2. 将每个 Task 转换成 DTO
        return tasks.stream().map(task -> {
            TaskResponseDTO dto = new TaskResponseDTO();
            dto.setTitle(task.getTitle());
            dto.setDescription(task.getDescription());

            // --- 核心：时区转换 ---
            if (task.getDueDate() != null) {
                // 假设数据库存的是 UTC，先给它穿上 UTC 的“外衣”
                ZonedDateTime utcTime = task.getDueDate().atZone(ZoneId.of("UTC"));
                // 转换为用户指定的时区（如 "America/Chicago"）
                ZonedDateTime localTime = utcTime.withZoneSameInstant(ZoneId.of(userTimezone));
                // 格式化为字符串存入 DTO
                dto.setLocalDueDate(localTime.format(FORMATTER));
            } else {
                dto.setLocalDueDate("No Deadline");
            }

            return dto;
        }).collect(Collectors.toList());
    }
}