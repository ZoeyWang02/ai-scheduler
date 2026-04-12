package com.wzy.aischeduler.entity;
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

    // ==========================================
    // 下面需要生成 Getters 和 Setters (这是 OOD 的封装特性)
    // ==========================================
    // 快捷操作：在 IntelliJ 里按 Alt+Insert (Windows) 或 Cmd+N (Mac)
    // 选择 "Getter and Setter"，全选所有属性，点击 OK 自动生成！
}