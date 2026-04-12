package com.wzy.aischeduler.repository;

import com.wzy.aischeduler.entity.Task;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

@Repository
public interface TaskRepository extends JpaRepository<Task, Long> {
    // 暂时不需要写任何代码，Spring Data JPA 会帮你搞定一切
}