package com.wzy.aischeduler.controller;

import java.util.List;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import com.wzy.aischeduler.dto.CourseEventDTO;
import com.wzy.aischeduler.service.CourseEventService;

@RestController
@RequestMapping("/api/courses")
public class CourseEventController {

    private final CourseEventService courseEventService;

    public CourseEventController(CourseEventService courseEventService) {
        this.courseEventService = courseEventService;
    }

    @PostMapping("/upload/ics")
    public ResponseEntity<String> uploadIcs(
            @RequestParam("file") MultipartFile file,
            @RequestParam Long userId,
            @RequestParam(defaultValue = "America/Chicago") String timezone) {
        try {
            int imported = courseEventService.importIcs(file.getInputStream(), userId, timezone);
            return ResponseEntity.ok("课程表导入成功，共导入 " + imported + " 个课程时间段。");
        } catch (Exception e) {
            return ResponseEntity.status(500).body("课程表导入失败: " + e.getMessage());
        }
    }

    @GetMapping
    public List<CourseEventDTO> getCourses(
            @RequestParam Long userId,
            @RequestParam(defaultValue = "America/Chicago") String timezone) {
        return courseEventService.getEvents(userId, timezone);
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<String> deleteCourse(@PathVariable Long id) {
        try {
            courseEventService.deleteEvent(id); 
            return ResponseEntity.ok("课程时间段移除成功");
        } catch (IllegalArgumentException e) {
            // 如果没找到这个课程，返回 404 状态码
            return ResponseEntity.status(404).body("删除失败: " + e.getMessage());
        } catch (Exception e) {
            // 其他未知错误，返回 500 状态码
            return ResponseEntity.status(500).body("服务器内部错误: " + e.getMessage());
        }
    }
}
