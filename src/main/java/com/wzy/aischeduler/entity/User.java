package com.wzy.aischeduler.entity;
import com.fasterxml.jackson.annotation.JsonIgnore;
import jakarta.persistence.*;
import java.time.LocalDateTime;

// @Entity 告诉 Spring：这个类对应数据库里的一张表
@Entity
// @Table(name = "users") 是因为 "user" 在 PostgreSQL 里是保留字，所以表名加个s
@Table(name = "users")
public class User {

    // @Id 声明这是主键
    // @GeneratedValue 告诉数据库自动递增生成这个 ID (类似 AUTO_INCREMENT)
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    // 学生的邮箱，必须唯一且不能为空
    @Column(nullable = false, unique = true)
    private String email;

    @Column(unique = true)
    private String username;

    @JsonIgnore
    @Column(name = "password_hash")
    private String passwordHash;

    @JsonIgnore
    @Column(name = "auth_token", unique = true)
    private String authToken;

    private String name;

    // 用于调用 Canvas API 的授权 Token (考虑到安全性，未来可以做加密)
    @Column(name = "canvas_token")
    private String canvasToken;

    // 记录账号创建时间
    @Column(name = "created_at", updatable = false)
    private LocalDateTime createdAt;

    // 这是一个生命周期回调：在插入数据库前自动设置当前时间
    @PrePersist
    protected void onCreate() {
        this.createdAt = LocalDateTime.now();
    }

    // 默认给 UIUC 所在的芝加哥时区
    private String timezone = "America/Chicago";

    // 或者用更通用的偏移量
    private String utcOffset = "UTC-5";

    public User() {
    }

    public Long getId() {
        return id;
    }

    public void setId(Long id) {
        this.id = id;
    }

    public String getEmail() {
        return email;
    }

    public void setEmail(String email) {
        this.email = email;
    }

    public String getUsername() {
        return username;
    }

    public void setUsername(String username) {
        this.username = username;
    }

    public String getPasswordHash() {
        return passwordHash;
    }

    public void setPasswordHash(String passwordHash) {
        this.passwordHash = passwordHash;
    }

    public String getAuthToken() {
        return authToken;
    }

    public void setAuthToken(String authToken) {
        this.authToken = authToken;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public String getCanvasToken() {
        return canvasToken;
    }

    public void setCanvasToken(String canvasToken) {
        this.canvasToken = canvasToken;
    }

    public LocalDateTime getCreatedAt() {
        return createdAt;
    }

    public void setCreatedAt(LocalDateTime createdAt) {
        this.createdAt = createdAt;
    }

    public String getTimezone() {
        return timezone;
    }

    public void setTimezone(String timezone) {
        this.timezone = timezone;
    }

    public String getUtcOffset() {
        return utcOffset;
    }

    public void setUtcOffset(String utcOffset) {
        this.utcOffset = utcOffset;
    }
}
