package com.wzy.aischeduler.service;

import java.time.format.DateTimeFormatter;
import java.util.List;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import com.wzy.aischeduler.dto.TaskResponseDTO;
import com.wzy.aischeduler.entity.Task;
import com.wzy.aischeduler.repository.TaskRepository;

@Service
public class TaskService {

    @Autowired
    private TaskRepository taskRepository;

    // 预设一个日期格式，让前端显示的更美观
    private static final DateTimeFormatter FORMATTER = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm");

    public List<TaskResponseDTO> getAllTasksForUser(String userTimezone, Long userId) {
        // 1. 从数据库拿到原始的 Task 列表
        List<Task> tasks = userId == null ? List.of() : taskRepository.findByUserId(userId);

        // 2. 将每个 Task 转换成 DTO
        return tasks.stream().map(task -> {
            TaskResponseDTO dto = new TaskResponseDTO();
            dto.setTitle(task.getTitle());
            dto.setDescription(task.getDescription());
            dto.setColor(task.getColor());

            // --- 核心：时区转换 ---
            if (task.getDueDate() != null) {
                // 1. 明确数据库里取出来的时间，是服务器的本地系统时间 (对应写入时的 systemDefault)
                java.time.ZoneId serverZone = java.time.ZoneId.systemDefault();
                // 2. 明确前端想要展示的时间，是用户当前选择的时区
                java.time.ZoneId userZone = java.time.ZoneId.of(userTimezone);

                // 3. 将服务器时间转换回用户时区的时间
                java.time.ZonedDateTime userTime = task.getDueDate()
                        .atZone(serverZone)
                        .withZoneSameInstant(userZone);

                // 4. 格式化并塞回 DTO
                dto.setLocalDueDate(userTime.format(FORMATTER));
            } else {
                dto.setLocalDueDate("No Deadline");
            }

            dto.setId(task.getId());
            return dto;
        }).collect(java.util.stream.Collectors.toList());
    }

    public void updateTaskColor(Long taskId, String newColor) {
        // 1. 从数据库中找到这个任务
        Task task = taskRepository.findById(taskId)
                .orElseThrow(() -> new RuntimeException("找不到ID为 " + taskId + " 的任务"));
        
        // 2. 修改颜色
        task.setColor(newColor);
        
        // 3. 保存回数据库
        taskRepository.save(task);
    }
}
