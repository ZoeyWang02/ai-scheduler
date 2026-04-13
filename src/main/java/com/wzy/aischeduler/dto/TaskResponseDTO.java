package com.wzy.aischeduler.dto;

public class TaskResponseDTO {
    private Long id;
    private String title;
    private String localDueDate; // 已经转换成 Urbana 时间的字符串
    private String description;

    // 无参构造函数（Jackson 反序列化需要）
    public TaskResponseDTO() {}

    // Getter 和 Setter
    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }

    public String getTitle() { return title; }
    public void setTitle(String title) { this.title = title; }

    public String getLocalDueDate() { return localDueDate; }
    public void setLocalDueDate(String localDueDate) { this.localDueDate = localDueDate; }

    public String getDescription() { return description; }
    public void setDescription(String description) { this.description = description; }


}