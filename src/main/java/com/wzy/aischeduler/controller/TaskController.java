package com.wzy.aischeduler.controller;

import com.wzy.aischeduler.dto.TaskResponseDTO;
import com.wzy.aischeduler.repository.TaskRepository;
import com.wzy.aischeduler.entity.Task;
import com.wzy.aischeduler.service.DataImportService;
import com.wzy.aischeduler.service.TaskService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.util.List;

@RestController // 告诉 Spring：这是一个对外公开的接口
@RequestMapping("/api/tasks") // 监听这个网址
public class TaskController {
    @Autowired
    private DataImportService dataImportService;

    @Autowired
    private TaskService taskService; // 确保你已经注入了 TaskService

    @Autowired
    private TaskRepository taskRepository;

    @GetMapping
    public List<TaskResponseDTO> getTasks(@RequestParam(defaultValue = "America/Chicago") String timezone) {
        return taskService.getAllTasksForUser(timezone);
    }
    // 💡 上传 Canvas JSON
    @PostMapping("/upload/canvas")
    public ResponseEntity<String> uploadCanvas(@RequestParam("file") MultipartFile file) {
        try {
            dataImportService.importCanvasData(file.getInputStream());
            return ResponseEntity.ok("Canvas 数据上传并同步成功！");
        } catch (Exception e) {
            return ResponseEntity.status(500).body("上传失败: " + e.getMessage());
        }
    }

    // 💡 上传 Coursera JSON
    @PostMapping("/upload/coursera")
    public ResponseEntity<String> uploadCoursera(@RequestParam("file") MultipartFile file) {
        try {
            dataImportService.importCourseraData(file.getInputStream());
            return ResponseEntity.ok("Coursera 数据上传成功！");
        } catch (Exception e) {
            return ResponseEntity.status(500).body("上传失败: " + e.getMessage());
        }
    }

    @PostMapping
    public ResponseEntity<Task> createTask(@RequestBody Task task) {
        // 这里的 task 对象包含 title, description, dueDate 等
        Task savedTask = TaskRepository.save(task);
        return ResponseEntity.ok(savedTask);
    }

}