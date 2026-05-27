package com.wzy.aischeduler.service;

import java.io.InputStream;
import java.time.ZonedDateTime;
import java.util.List;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.wzy.aischeduler.entity.Task;
import com.wzy.aischeduler.entity.User;
import com.wzy.aischeduler.repository.TaskRepository;
import com.wzy.aischeduler.repository.UserRepository;

@Service
public class DataImportService {

    @Autowired
    private TaskRepository taskRepository;

    @Autowired
    private UserRepository userRepository;

    private final ObjectMapper objectMapper = new ObjectMapper();

    public void importCanvasData(InputStream is, Long userId) {
        try {
            User user = getUser(userId);
            // 1. 将输入流解析为 JSON 树
            JsonNode rootNode = objectMapper.readTree(is);
            if (!rootNode.isArray()) {
                throw new IllegalArgumentException("Canvas JSON 顶层应该是数组，请确认上传的是 Canvas 文件。");
            }

            // 2. 遍历 Canvas 的 Group 结构 (对应你抓取的 json 数组)
            int newTasksCount = 0;
            int skippedCount = 0;

            for (JsonNode group : rootNode) {
                String groupName = group.path("name").asText();
                JsonNode assignments = group.path("assignments");
                if (!assignments.isArray()) {
                    continue;
                }

                for (JsonNode adj : assignments) {
                    String title = adj.path("name").asText();
                    if (title == null || title.isBlank()) {
                        skippedCount++;
                        continue;
                    }

                    List<Task> existingTasks = taskRepository.findByTitleAndUserId(title, user.getId());
                    if (!existingTasks.isEmpty()) {
                        skippedCount++;
                        continue;
                    }

                    Task task = new Task();
                    task.setTitle(title);
                    task.setUser(user);

                    String dueStr = adj.path("due_at").asText();
                    if (dueStr != null && !dueStr.equals("null") && !dueStr.isEmpty()) {
                        // 1. 解析 Canvas 传来的原生时间（自带时区信息）
                        ZonedDateTime canvasTime = ZonedDateTime.parse(dueStr);
    
                        // 2. 将其转换到我们数据库统一规定的“服务器系统时区”
                        java.time.LocalDateTime normalizedServerTime = canvasTime
                           .withZoneSameInstant(java.time.ZoneId.systemDefault())
                           .toLocalDateTime();
            
                         // 3. 存入 Task
                        task.setDueDate(normalizedServerTime);
                    }

                    task.setDescription("From Canvas Group: " + groupName +
                            "\nURL: " + adj.path("html_url").asText());

                    taskRepository.save(task);
                    newTasksCount++;
                }
            }
            System.out.println("🎉 导入统计 -> 新增: " + newTasksCount + " 条, 跳过: " + skippedCount + " 条。");
        } catch (Exception e) {
            System.err.println("❌ 导入 Canvas 数据时发生致命错误: " + e.getMessage());
            e.printStackTrace();
            throw new RuntimeException(e.getMessage());
        }
    }

    public void importCourseraData(InputStream is, Long userId) {
        try {
            User user = getUser(userId);
            JsonNode rootNode = objectMapper.readTree(is);
            // 1. 定位到具体的任务项列表
            JsonNode items = rootNode.path("linked").path("onDemandCourseMaterialItems.v2");
            if (!items.isArray()) {
                throw new IllegalArgumentException("Coursera JSON 中没有找到 linked.onDemandCourseMaterialItems.v2，请确认文件来源。");
            }

            int newTasksCount = 0;
            int skippedCount = 0;

            for (JsonNode item : items) {
                String title = item.path("name").asText();
                if (title == null || title.isBlank()) {
                    skippedCount++;
                    continue;
                }

                // 2. 🛡️ 去重检查：防止重复导入相同名称的任务
                List<Task> existingTasks = taskRepository.findByTitleAndUserId(title, user.getId());
                if (!existingTasks.isEmpty()) {
                    skippedCount++;
                    continue;
                }

                // 3. 填充任务对象
                Task task = new Task();
                task.setTitle(title);
                task.setUser(user);

                // 注意：Coursera JSON 中通常没有固定的截止日期字段(due_at)
                // 我们可以通过 timeCommitment (毫秒) 来估算任务量并存入描述
                long commitmentMs = item.path("timeCommitment").asLong();
                double hours = (double) commitmentMs / (1000 * 60 * 60);

                task.setDescription(String.format("来源: Coursera\n预计耗时: %.2f 小时\nSlug: %s",
                        hours, item.path("slug").asText()));

                // 默认设置一个日期，或者留空让用户在日历上手动拖拽
                // task.setDueDate(LocalDateTime.now().plusDays(7));

                taskRepository.save(task);
                newTasksCount++;
            }
            System.out.println("🎉 Coursera 数据导入完成 -> 新增: " + newTasksCount + " 条, 跳过: " + skippedCount + " 条。");
        } catch (Exception e) {
            System.err.println("❌ Coursera 解析失败: " + e.getMessage());
            throw new RuntimeException(e.getMessage());
        }
    }

    private User getUser(Long userId) {
        if (userId == null) {
            throw new IllegalArgumentException("请先登录后再导入任务。");
        }
        return userRepository.findById(userId)
                .orElseThrow(() -> new IllegalArgumentException("当前登录用户不存在，请重新登录。"));
    }
}
