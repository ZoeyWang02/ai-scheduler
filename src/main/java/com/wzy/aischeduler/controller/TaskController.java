package com.wzy.aischeduler.controller;

import java.util.List;
import java.util.Map;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import com.wzy.aischeduler.dto.TaskResponseDTO;
import com.wzy.aischeduler.entity.Task;
import com.wzy.aischeduler.entity.User;
import com.wzy.aischeduler.repository.TaskRepository;
import com.wzy.aischeduler.repository.UserRepository;
import com.wzy.aischeduler.service.DataImportService;
import com.wzy.aischeduler.service.TaskService;

@RestController // 告诉 Spring：这是一个对外公开的接口
@RequestMapping("/api/tasks") // 监听这个网址
public class TaskController {
    @Autowired
    private DataImportService dataImportService;

    @Autowired
    private TaskService taskService; // 确保你已经注入了 TaskService

    @Autowired
    private TaskRepository taskRepository;

    @Autowired
    private UserRepository userRepository;

    @GetMapping
    public List<TaskResponseDTO> getTasks(
            @RequestParam(defaultValue = "America/Chicago") String timezone,
            @RequestParam(required = false) Long userId) {
        return taskService.getAllTasksForUser(timezone, userId);
    }
    //上传 Canvas JSON
    @PostMapping("/upload/canvas")
    public ResponseEntity<String> uploadCanvas(@RequestParam("file") MultipartFile file,
                                               @RequestParam Long userId) {
        try {
            dataImportService.importCanvasData(file.getInputStream(), userId);
            return ResponseEntity.ok("Canvas 数据上传并同步成功！");
        } catch (Exception e) {
            return ResponseEntity.status(500).body("上传失败: " + e.getMessage());
        }
    }

    //上传 Coursera JSON
    @PostMapping("/upload/coursera")
    public ResponseEntity<String> uploadCoursera(@RequestParam("file") MultipartFile file,
                                                 @RequestParam Long userId) {
        try {
            dataImportService.importCourseraData(file.getInputStream(), userId);
            return ResponseEntity.ok("Coursera 数据上传成功！");
        } catch (Exception e) {
            return ResponseEntity.status(500).body("上传失败: " + e.getMessage());
        }
    }

    @PostMapping
    public ResponseEntity<Task> createTask(@RequestBody Task task,
                                           @RequestParam Long userId,
                                           @RequestParam(defaultValue = "America/Chicago") String timezone) { // 🌟 接收时区参数
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new IllegalArgumentException("当前登录用户不存在，请重新登录。"));
        task.setUser(user);
        
        // 🌟 核心修复：将 AI 生成的用户本地时间，正确转换为系统数据库的基准时间（如服务器本地或UTC）后再保存
        if (task.getDueDate() != null) {
            java.time.ZoneId userZone = java.time.ZoneId.of(timezone);
            java.time.ZoneId serverZone = java.time.ZoneId.systemDefault();
            
            // 视作用户时区的时间，然后转为服务器系统时区的时间
            java.time.LocalDateTime normalizedDeadline = task.getDueDate()
                    .atZone(userZone)
                    .withZoneSameInstant(serverZone)
                    .toLocalDateTime();
                    
            task.setDueDate(normalizedDeadline);
        }

        Task savedTask = taskRepository.save(task);
        return ResponseEntity.ok(savedTask);
    }

    /**
     * 接收前端更新任务颜色的请求
     * 对应的 HTTP 请求：PATCH /api/tasks/{id}/color
     */
    @PatchMapping("/{id}/color")
    public ResponseEntity<?> updateTaskColor(@PathVariable("id") Long id, @RequestBody Map<String, String> requestBody) {
        // 从请求的 JSON 体 {"color": "#FF5733"} 中提取 color 的值
        String newColor = requestBody.get("color");
        
        if (newColor == null || newColor.trim().isEmpty()) {
            return ResponseEntity.badRequest().body("颜色值不能为空");
        }

        try {
            // 调用 Service 层去更新数据库
            taskService.updateTaskColor(id, newColor);
            return ResponseEntity.ok().body("颜色更新成功");
        } catch (Exception e) {
            return ResponseEntity.badRequest().body("更新失败: " + e.getMessage());
        }
    }

    // 删除任务的接口
    @DeleteMapping("/{id}")
    public ResponseEntity<String> deleteTask(@PathVariable Long id) {
        try {
            taskRepository.deleteById(id);
            return ResponseEntity.ok("任务已成功删除");
        } catch (Exception e) {
            return ResponseEntity.status(500).body("删除失败: " + e.getMessage());
        }
    }

    // 🌟 处理前端手动编辑任务的请求
    @org.springframework.web.bind.annotation.PutMapping("/{id}")
    public ResponseEntity<?> updateTask(@PathVariable Long id, @RequestBody com.wzy.aischeduler.entity.Task updatedTask, @RequestParam String timezone) {
        try {
            com.wzy.aischeduler.entity.Task existingTask = taskRepository.findById(id)
                    .orElseThrow(() -> new IllegalArgumentException("Task not found"));
            
            existingTask.setTitle(updatedTask.getTitle());
            existingTask.setDescription(updatedTask.getDescription());
            
            if (updatedTask.getDueDate() != null) {
                java.time.ZoneId userZone = java.time.ZoneId.of(timezone);
                java.time.ZoneId serverZone = java.time.ZoneId.systemDefault();
                java.time.ZonedDateTime localZoned = updatedTask.getDueDate().atZone(userZone);
                existingTask.setDueDate(localZoned.withZoneSameInstant(serverZone).toLocalDateTime());
            }
            
            taskRepository.save(existingTask);
            return ResponseEntity.ok("更新成功");
        } catch (Exception e) {
            return ResponseEntity.badRequest().body("更新失败: " + e.getMessage());
        }
    }

}
