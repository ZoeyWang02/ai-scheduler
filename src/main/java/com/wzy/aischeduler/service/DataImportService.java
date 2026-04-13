package com.wzy.aischeduler.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.wzy.aischeduler.entity.Task;
import com.wzy.aischeduler.repository.TaskRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.io.InputStream;
import java.time.ZonedDateTime;
import java.util.List;

@Service
public class DataImportService {

    @Autowired
    private TaskRepository taskRepository;

    private final ObjectMapper objectMapper = new ObjectMapper();

    public void importCanvasData(InputStream is) {
        try {
            // 1. 将输入流解析为 JSON 树
            JsonNode rootNode = objectMapper.readTree(is);

            // 2. 遍历 Canvas 的 Group 结构 (对应你抓取的 json 数组)
            if (rootNode.isArray()) {
                int newTasksCount = 0;
                int skippedCount = 0;

                for (JsonNode group : rootNode) {
                    String groupName = group.path("name").asText();
                    JsonNode assignments = group.path("assignments");

                    for (JsonNode adj : assignments) {
                        String title = adj.path("name").asText();

                        // 3. 🛡️ 去重逻辑：查找数据库中是否已有该标题的任务
                        // 使用 List 接收以防止数据库中存在历史重复数据时抛出 NonUniqueResultException
                        List<Task> existingTasks = taskRepository.findByTitle(title);

                        if (!existingTasks.isEmpty()) {
                            skippedCount++;
                            // System.out.println("⏭️ 跳过已存在任务: " + title);
                            continue;
                        }

                        // 4. 创建并填充任务实体
                        Task task = new Task();
                        task.setTitle(title);

                        // 处理时间：将 Canvas 的 UTC 字符串转为本地时间
                        String dueStr = adj.path("due_at").asText();
                        if (dueStr != null && !dueStr.equals("null") && !dueStr.isEmpty()) {
                            task.setDueDate(ZonedDateTime.parse(dueStr).toLocalDateTime());
                        }

                        // 填充描述信息，包含来源和链接
                        task.setDescription("From Canvas Group: " + groupName +
                                "\nURL: " + adj.path("html_url").asText());

                        // 5. 持久化到数据库
                        taskRepository.save(task);
                        newTasksCount++;
                    }
                }
                System.out.println("🎉 导入统计 -> 新增: " + newTasksCount + " 条, 跳过: " + skippedCount + " 条。");
            }
        } catch (Exception e) {
            System.err.println("❌ 导入 Canvas 数据时发生致命错误: " + e.getMessage());
            e.printStackTrace();
            throw new RuntimeException("数据解析失败，请检查文件格式。");
        }
    }

    public void importCourseraData(InputStream is) {
        try {
            JsonNode rootNode = objectMapper.readTree(is);
            // 1. 定位到具体的任务项列表
            JsonNode items = rootNode.path("linked").path("onDemandCourseMaterialItems.v2");

            if (items.isArray()) {
                int newTasksCount = 0;
                int skippedCount = 0;

                for (JsonNode item : items) {
                    String title = item.path("name").asText();

                    // 2. 🛡️ 去重检查：防止重复导入相同名称的任务
                    List<Task> existingTasks = taskRepository.findByTitle(title);
                    if (!existingTasks.isEmpty()) {
                        skippedCount++;
                        continue;
                    }

                    // 3. 填充任务对象
                    Task task = new Task();
                    task.setTitle(title);

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
            }
        } catch (Exception e) {
            System.err.println("❌ Coursera 解析失败: " + e.getMessage());
            throw new RuntimeException("Coursera JSON 格式不正确");
        }
    }

}