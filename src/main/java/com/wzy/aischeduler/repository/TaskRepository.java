package com.wzy.aischeduler.repository;

import com.wzy.aischeduler.entity.Task;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

@Repository
public interface TaskRepository extends JpaRepository<Task, Long> {
    List<Task> findByTitle(String title);
    List<Task> findByUserId(Long userId);
    List<Task> findByTitleAndUserId(String title, Long userId);

    // Import de-duplication: first by the upstream item's stable key, then by
    // title + deadline (a null deadline matches rows whose deadline is null).
    Optional<Task> findFirstByUserIdAndImportKey(Long userId, String importKey);
    List<Task> findByUserIdAndTitleAndDueDate(Long userId, String title, LocalDateTime dueDate);
}
