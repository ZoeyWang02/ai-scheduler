package com.wzy.aischeduler.controller;

import com.wzy.aischeduler.dto.TaskResponseDTO;
import com.wzy.aischeduler.service.TaskService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController // 告诉 Spring：这是一个对外公开的接口
@RequestMapping("/api/tasks") // 监听这个网址
public class TaskController {

    @Autowired
    private TaskService taskService; // 注入你的“大脑”

    @GetMapping
    public List<TaskResponseDTO> getTasks() {
        // 让大脑干活，并返回结果
        return taskService.getAllTasksForUser("America/Chicago");
    }
}