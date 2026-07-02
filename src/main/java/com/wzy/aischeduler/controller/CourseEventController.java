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
import com.wzy.aischeduler.entity.CourseEvent;
import com.wzy.aischeduler.entity.User;
import com.wzy.aischeduler.repository.CourseEventRepository;
import com.wzy.aischeduler.service.AuthService;
import com.wzy.aischeduler.service.CourseEventService;

@RestController
@RequestMapping("/api/courses")
public class CourseEventController {
    private final CourseEventService courseEventService;
    private final CourseEventRepository courseEventRepository;
    private final AuthService authService;

    public CourseEventController(CourseEventService courseEventService,
                                 CourseEventRepository courseEventRepository,
                                 AuthService authService) {
        this.courseEventService = courseEventService;
        this.courseEventRepository = courseEventRepository;
        this.authService = authService;
    }

    @PostMapping("/upload/ics")
    public ResponseEntity<String> uploadIcs(
            @RequestParam("file") MultipartFile file,
            @RequestParam Long userId,
            @RequestParam String authToken,
            @RequestParam(defaultValue = "America/Chicago") String timezone) {
        try {
            authService.requireUser(userId, authToken);
            int imported = courseEventService.importIcs(file.getInputStream(), userId, timezone);
            return ResponseEntity.ok("Course schedule imported successfully. Imported " + imported + " sessions.");
        } catch (SecurityException e) {
            return ResponseEntity.status(401).body(e.getMessage());
        } catch (Exception e) {
            return ResponseEntity.status(500).body("Course import failed: " + e.getMessage());
        }
    }

    @GetMapping
    public List<CourseEventDTO> getCourses(
            @RequestParam Long userId,
            @RequestParam String authToken,
            @RequestParam(defaultValue = "America/Chicago") String timezone) {
        if (userId < 0) {
            return List.of();
        }
        authService.requireUser(userId, authToken);
        return courseEventService.getEvents(userId, timezone);
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<String> deleteCourse(@PathVariable Long id, @RequestParam String authToken) {
        try {
            CourseEvent event = requireOwnedCourse(id, authToken);
            courseEventRepository.delete(event);
            return ResponseEntity.ok("Course session deleted.");
        } catch (SecurityException e) {
            return ResponseEntity.status(403).body(e.getMessage());
        } catch (IllegalArgumentException e) {
            return ResponseEntity.status(404).body("Delete failed: " + e.getMessage());
        } catch (Exception e) {
            return ResponseEntity.status(500).body("Server error: " + e.getMessage());
        }
    }

    private CourseEvent requireOwnedCourse(Long courseId, String authToken) {
        User user = authService.requireToken(authToken);
        CourseEvent event = courseEventRepository.findById(courseId)
                .orElseThrow(() -> new IllegalArgumentException("Course not found"));
        if (event.getUser() == null || !event.getUser().getId().equals(user.getId())) {
            throw new SecurityException("Forbidden");
        }
        return event;
    }
}
