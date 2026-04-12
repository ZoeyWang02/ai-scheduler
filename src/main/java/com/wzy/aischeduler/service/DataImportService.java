package com.wzy.aischeduler.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.wzy.aischeduler.entity.Task;
import com.wzy.aischeduler.repository.TaskRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Service;

import java.io.InputStream;
import java.time.ZonedDateTime;

@Service
public class DataImportService {

    @Autowired
    private TaskRepository taskRepository;

    private final ObjectMapper objectMapper = new ObjectMapper();

    public void importCanvasData() {
        try {
            // 1. 读取本地 JSON 文件
            InputStream is = new ClassPathResource("data/canvas_raw_data.json").getInputStream();
            JsonNode rootNode = objectMapper.readTree(is);

            // 2. 嵌套循环解析（匹配你抓到的 Group 结构）
            if (rootNode.isArray()) {
                for (JsonNode group : rootNode) {
                    String groupName = group.path("name").asText();
                    JsonNode assignments = group.path("assignments");

                    for (JsonNode adj : assignments) {
                        // 创建实体对象
                        Task task = new Task();
                        task.setTitle(adj.path("name").asText());

                        // 处理时间（跳过没有截止日期的项）
                        String dueStr = adj.path("due_at").asText();
                        if (dueStr != null && !dueStr.equals("null") && !dueStr.isEmpty()) {
                            task.setDueDate(ZonedDateTime.parse(dueStr).toLocalDateTime());//UTC时间
                        }

                        // 填充描述（这里可以把 Canvas 的 URL 存进去，方便以后点击）
                        task.setDescription("From Canvas Group: " + groupName +
                                "\nURL: " + adj.path("html_url").asText());

                        // 3. 核心：保存到 PostgreSQL 数据库
                        taskRepository.save(task);

                        System.out.println("✅ 已存入数据库: [" + groupName + "] " + task.getTitle());
                    }
                }
            }
            System.out.println("🎉 所有 Canvas 数据导入完成！");
        } catch (Exception e) {
            System.err.println("❌ 导入过程中发生错误: " + e.getMessage());
            e.printStackTrace();
        }
    }
}