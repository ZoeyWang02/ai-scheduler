package com.wzy.aischeduler.entity;

import java.time.LocalDateTime;
import java.util.Map;

import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;

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

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "user_id", nullable = false)
    private User user; // 每个任务必须属于一个用户

    // 在类中新增
    @Column(name = "color", length = 7)
    private String color; // 例如 "#FF5733"

    public Task() {}

    public Long getId() { return id; }

    public void setId(Long id) { this.id = id; }

    public String getTitle() { return title; }

    public void setTitle(String title) { this.title = title;}

    public String getDescription() { return description; }

    public void setDescription(String description) { this.description = description; }

    public LocalDateTime getDueDate() { return dueDate; }

    public void setDueDate(LocalDateTime dueDate) { this.dueDate = dueDate; }

    public boolean isCompleted() { return completed; }

    public void setCompleted(boolean completed) { this.completed = completed; }

    public Map<String, Object> getAiMetadata() { return aiMetadata; }

    public void setAiMetadata(Map<String, Object> aiMetadata) { this.aiMetadata = aiMetadata; }

    public Task getPrecededBy() { return precededBy; }

    public void setPrecededBy(Task precededBy) { this.precededBy = precededBy; }

    public User getUser() { return user; }

    public void setUser(User user) { this.user = user; }

    public String getColor() { return color; }

    public void setColor(String color) { this.color = color; }
}
