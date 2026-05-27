package com.wzy.aischeduler.repository;

import com.wzy.aischeduler.entity.CourseEvent;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.time.LocalDateTime;
import java.util.List;

@Repository
public interface CourseEventRepository extends JpaRepository<CourseEvent, Long> {
    List<CourseEvent> findByUserId(Long userId);
    List<CourseEvent> findByUserIdAndStartTimeBetween(Long userId, LocalDateTime start, LocalDateTime end);
}
