package com.wzy.aischeduler.service;

import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.List;

import org.springframework.stereotype.Service;

import com.wzy.aischeduler.dto.TaskResponseDTO;
import com.wzy.aischeduler.entity.Task;
import com.wzy.aischeduler.repository.TaskRepository;

@Service
public class TaskService {
    private static final DateTimeFormatter DISPLAY_FORMATTER = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm");
    private static final ZoneId STORAGE_ZONE = ZoneId.of("UTC");

    private final TaskRepository taskRepository;

    public TaskService(TaskRepository taskRepository) {
        this.taskRepository = taskRepository;
    }

    public List<TaskResponseDTO> getAllTasksForUser(String userTimezone, Long userId) {
        List<Task> tasks = userId == null ? List.of() : taskRepository.findByUserId(userId);
        ZoneId userZone = ZoneId.of(userTimezone);

        return tasks.stream().map(task -> toDto(task, userZone)).toList();
    }

    public void updateTaskColor(Long taskId, String newColor) {
        Task task = taskRepository.findById(taskId)
                .orElseThrow(() -> new RuntimeException("Task not found: " + taskId));
        task.setColor(newColor);
        taskRepository.save(task);
    }

    private TaskResponseDTO toDto(Task task, ZoneId userZone) {
        TaskResponseDTO dto = new TaskResponseDTO();
        dto.setId(task.getId());
        dto.setTitle(task.getTitle());
        dto.setDescription(task.getDescription());
        dto.setColor(task.getColor());
        dto.setCompleted(task.isCompleted());

        if (task.getDueDate() == null) {
            dto.setLocalDueDate("No Deadline");
            return dto;
        }

        var userTime = task.getDueDate()
                .atZone(STORAGE_ZONE)
                .withZoneSameInstant(userZone)
                .toLocalDateTime();
        dto.setLocalDueDate(userTime.format(DISPLAY_FORMATTER));
        dto.setDueDate(userTime.toString());
        return dto;
    }
}
