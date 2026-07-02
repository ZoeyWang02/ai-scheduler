package com.wzy.aischeduler.dto;

public class TaskResponseDTO {
    private Long id;
    private String title;
    private String localDueDate;
    private String dueDate;
    private String description;
    private String color;

    public TaskResponseDTO() {}

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }

    public String getTitle() { return title; }
    public void setTitle(String title) { this.title = title; }

    public String getLocalDueDate() { return localDueDate; }
    public void setLocalDueDate(String localDueDate) { this.localDueDate = localDueDate; }

    public String getDueDate() { return dueDate; }
    public void setDueDate(String dueDate) { this.dueDate = dueDate; }

    public String getDescription() { return description; }
    public void setDescription(String description) { this.description = description; }

    public String getColor() { return color; }
    public void setColor(String color) { this.color = color; }
}
