package com.wzy.aischeduler.controller;

import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.List;
import java.util.Map;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import com.wzy.aischeduler.dto.BuddyStateDTO;
import com.wzy.aischeduler.dto.TaskResponseDTO;
import com.wzy.aischeduler.entity.Task;
import com.wzy.aischeduler.entity.User;
import com.wzy.aischeduler.repository.TaskRepository;
import com.wzy.aischeduler.service.AuthService;
import com.wzy.aischeduler.service.BuddyStateService;
import com.wzy.aischeduler.service.DataImportService;
import com.wzy.aischeduler.service.TaskService;

@RestController
@RequestMapping("/api/tasks")
public class TaskController {
    private final DataImportService dataImportService;
    private final TaskService taskService;
    private final TaskRepository taskRepository;
    private final AuthService authService;
    private final BuddyStateService buddyStateService;

    public TaskController(DataImportService dataImportService,
                          TaskService taskService,
                          TaskRepository taskRepository,
                          AuthService authService,
                          BuddyStateService buddyStateService) {
        this.dataImportService = dataImportService;
        this.taskService = taskService;
        this.taskRepository = taskRepository;
        this.authService = authService;
        this.buddyStateService = buddyStateService;
    }

    @GetMapping
    public List<TaskResponseDTO> getTasks(
            @RequestParam(defaultValue = "America/Chicago") String timezone,
            @RequestParam(required = false) Long userId,
            @RequestParam(required = false) String authToken) {
        if (userId != null) {
            authService.requireUser(userId, authToken);
        }
        return taskService.getAllTasksForUser(timezone, userId);
    }

    @PostMapping("/upload/canvas")
    public ResponseEntity<String> uploadCanvas(@RequestParam("file") MultipartFile file,
                                               @RequestParam Long userId,
                                               @RequestParam String authToken) {
        try {
            authService.requireUser(userId, authToken);
            dataImportService.importCanvasData(file.getInputStream(), userId);
            return ResponseEntity.ok("Canvas data imported successfully.");
        } catch (SecurityException e) {
            return ResponseEntity.status(401).body(e.getMessage());
        } catch (Exception e) {
            return ResponseEntity.status(500).body("Upload failed: " + e.getMessage());
        }
    }

    @PostMapping("/upload/coursera")
    public ResponseEntity<String> uploadCoursera(@RequestParam("file") MultipartFile file,
                                                 @RequestParam Long userId,
                                                 @RequestParam String authToken) {
        try {
            authService.requireUser(userId, authToken);
            dataImportService.importCourseraData(file.getInputStream(), userId);
            return ResponseEntity.ok("Coursera data imported successfully.");
        } catch (SecurityException e) {
            return ResponseEntity.status(401).body(e.getMessage());
        } catch (Exception e) {
            return ResponseEntity.status(500).body("Upload failed: " + e.getMessage());
        }
    }

    @PostMapping
    public ResponseEntity<?> createTask(@RequestBody Task task,
                                        @RequestParam Long userId,
                                        @RequestParam String authToken,
                                        @RequestParam(defaultValue = "America/Chicago") String timezone) {
        try {
            User user = authService.requireUser(userId, authToken);
            task.setUser(user);
            task.setDueDate(toUtc(task.getDueDate(), timezone));
            return ResponseEntity.ok(taskRepository.save(task));
        } catch (SecurityException e) {
            return ResponseEntity.status(401).body(e.getMessage());
        } catch (Exception e) {
            return ResponseEntity.badRequest().body("Create failed: " + e.getMessage());
        }
    }

    @PatchMapping("/{id}/color")
    public ResponseEntity<?> updateTaskColor(@PathVariable Long id,
                                             @RequestParam String authToken,
                                             @RequestBody Map<String, String> requestBody) {
        String newColor = requestBody.get("color");
        if (newColor == null || newColor.trim().isEmpty()) {
            return ResponseEntity.badRequest().body("Color cannot be empty.");
        }
        try {
            Task task = requireOwnedTask(id, authToken);
            taskService.updateTaskColor(task.getId(), newColor);
            return ResponseEntity.ok("Color updated.");
        } catch (SecurityException e) {
            return ResponseEntity.status(403).body(e.getMessage());
        } catch (Exception e) {
            return ResponseEntity.badRequest().body("Update failed: " + e.getMessage());
        }
    }

    @PatchMapping("/{id}/complete")
    public ResponseEntity<?> setTaskCompleted(@PathVariable Long id,
                                              @RequestParam String authToken,
                                              @RequestBody Map<String, Boolean> requestBody) {
        try {
            Task task = requireOwnedTask(id, authToken);
            boolean completed = Boolean.TRUE.equals(requestBody.get("completed"));
            task.setCompleted(completed);
            task.setCompletedAt(completed ? LocalDateTime.now(ZoneId.of("UTC")) : null);
            taskRepository.save(task);

            BuddyStateDTO buddyState = buddyStateService.getStateAfterCompletionToggle(task.getUser().getId(), task);
            return ResponseEntity.ok(Map.of(
                    "message", "Task completion updated.",
                    "buddyState", buddyState
            ));
        } catch (SecurityException e) {
            return ResponseEntity.status(403).body(e.getMessage());
        } catch (Exception e) {
            return ResponseEntity.badRequest().body("Update failed: " + e.getMessage());
        }
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<String> deleteTask(@PathVariable Long id, @RequestParam String authToken) {
        try {
            Task task = requireOwnedTask(id, authToken);
            taskRepository.delete(task);
            return ResponseEntity.ok("Task deleted.");
        } catch (SecurityException e) {
            return ResponseEntity.status(403).body(e.getMessage());
        } catch (Exception e) {
            return ResponseEntity.status(500).body("Delete failed: " + e.getMessage());
        }
    }

    @PutMapping("/{id}")
    public ResponseEntity<?> updateTask(@PathVariable Long id,
                                        @RequestBody Task updatedTask,
                                        @RequestParam String timezone,
                                        @RequestParam String authToken) {
        try {
            Task existingTask = requireOwnedTask(id, authToken);
            existingTask.setTitle(updatedTask.getTitle());
            existingTask.setDescription(updatedTask.getDescription());
            if (updatedTask.getDueDate() != null) {
                existingTask.setDueDate(toUtc(updatedTask.getDueDate(), timezone));
            }
            taskRepository.save(existingTask);
            return ResponseEntity.ok("Task updated.");
        } catch (SecurityException e) {
            return ResponseEntity.status(403).body(e.getMessage());
        } catch (Exception e) {
            return ResponseEntity.badRequest().body("Update failed: " + e.getMessage());
        }
    }

    private Task requireOwnedTask(Long taskId, String authToken) {
        User user = authService.requireToken(authToken);
        Task task = taskRepository.findById(taskId)
                .orElseThrow(() -> new IllegalArgumentException("Task not found"));
        if (task.getUser() == null || !task.getUser().getId().equals(user.getId())) {
            throw new SecurityException("Forbidden");
        }
        return task;
    }

    private LocalDateTime toUtc(LocalDateTime localDateTime, String timezone) {
        if (localDateTime == null) {
            return null;
        }
        return localDateTime.atZone(ZoneId.of(timezone))
                .withZoneSameInstant(ZoneId.of("UTC"))
                .toLocalDateTime();
    }
}
