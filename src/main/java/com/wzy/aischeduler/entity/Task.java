package com.wzy.aischeduler.entity;

import jakarta.persistence.*;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;
import java.time.LocalDateTime;
import java.util.Map;

@Entity
@Table(name = "tasks")
public class Task {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    // 对应 Canvas 的 "name"
    private String title;

    // 存课程链接或详细描述
    @Column(columnDefinition = "TEXT")
    private String description;

    // 对应 Canvas 的 "due_at"
    private LocalDateTime dueDate;

    // --- 💡 核心功能：任务状态 ---
    private boolean completed = false;

    // --- 🚀 面试亮点 1: PostgreSQL 专属 JSONB ---
    // 这里用来存你以后用 AI (GPT/Gemini) 解析出来的子步骤、学习计划等
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(columnDefinition = "jsonb")
    private Map<String, Object> aiMetadata;

    // --- 🚀 面试亮点 2: 自关联 (Self-Reference) ---
    // 比如：任务 A 必须在 任务 B 之前完成
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "preceded_by_id")
    private Task precededBy;

    // --- Getter 和 Setter (建议使用 Alt+Insert 自动生成) ---
    // 为了节省篇幅，这里我省略了，你可以在 IntelliJ 里右键 -> Generate -> Getter and Setter 全选生成

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }

    public String getTitle() { return title; }
    public void setTitle(String title) { this.title = title; }

    public String getDescription() { return description; }
    public void setDescription(String description) { this.description = description; }

    public LocalDateTime getDueDate() { return dueDate; }
    public void setDueDate(LocalDateTime dueDate) { this.dueDate = dueDate; }

    // ...以此类推生成其他的
}