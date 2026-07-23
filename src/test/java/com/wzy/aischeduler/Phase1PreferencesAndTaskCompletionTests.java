package com.wzy.aischeduler;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.transaction.annotation.Transactional;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.wzy.aischeduler.entity.Task;
import com.wzy.aischeduler.repository.TaskRepository;

/**
 * Phase 1 覆盖点：
 * 1. 设置弹窗保存的 preferences 能真正落库，并且重新登录（signin 接口）会把它带回来——
 *    这是用户实测反馈"退出重进后主题/头像变回默认"对应的确切链路。
 * 2. 勾选任务完成会写 completed_at（UTC），取消勾选会清空，为 Phase 3 的作息学习积累数据。
 *
 * 每个测试方法跑在独立事务里，结束自动回滚，不污染真实数据。
 */
@SpringBootTest
@AutoConfigureMockMvc
@Transactional
class Phase1PreferencesAndTaskCompletionTests {

    @Autowired
    private MockMvc mockMvc;

    private final ObjectMapper objectMapper = new ObjectMapper();

    @Autowired
    private TaskRepository taskRepository;

    private JsonNode signUpTestUser() throws Exception {
        String unique = UUID.randomUUID().toString().substring(0, 8);
        Map<String, String> payload = Map.of(
                "username", "phase1_" + unique,
                "email", "phase1_" + unique + "@example.com",
                "password", "testpass123",
                "timezone", "America/Chicago"
        );
        MvcResult result = mockMvc.perform(post("/api/auth/signup")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(payload)))
                .andExpect(status().isOk())
                .andReturn();
        return objectMapper.readTree(result.getResponse().getContentAsString());
    }

    @Test
    void preferencesPersistAndReturnOnReSignIn() throws Exception {
        JsonNode signUp = signUpTestUser();
        long userId = signUp.get("id").asLong();
        String token = signUp.get("token").asText();
        String username = signUp.get("username").asText();
        assertTrue(signUp.get("preferences").isNull(), "New account should start with no saved preferences");

        // 模拟设置弹窗点击"保存"
        Map<String, Object> prefs = Map.of("theme", "stardew", "studyBuddy", "rabbit");
        mockMvc.perform(put("/api/auth/preferences")
                        .param("userId", String.valueOf(userId))
                        .param("authToken", token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(prefs)))
                .andExpect(status().isOk());

        mockMvc.perform(get("/api/auth/preferences")
                        .param("userId", String.valueOf(userId))
                        .param("authToken", token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.theme").value("stardew"))
                .andExpect(jsonPath("$.studyBuddy").value("rabbit"));

        // 用户实测反馈的确切场景：退出重新登录，preferences 必须原样带回来
        Map<String, String> signInPayload = Map.of(
                "identifier", username,
                "password", "testpass123",
                "timezone", "America/Chicago"
        );
        mockMvc.perform(post("/api/auth/signin")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(signInPayload)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.preferences.theme").value("stardew"))
                .andExpect(jsonPath("$.preferences.studyBuddy").value("rabbit"));
    }

    @Test
    void markingTaskCompleteStampsCompletedAtInUtcAndUncheckingClearsIt() throws Exception {
        JsonNode signUp = signUpTestUser();
        long userId = signUp.get("id").asLong();
        String token = signUp.get("token").asText();

        Map<String, Object> taskPayload = Map.of(
                "title", "Phase1 completion test task",
                "description", "created by automated test",
                "dueDate", "2026-07-10T15:00:00"
        );
        MvcResult createResult = mockMvc.perform(post("/api/tasks")
                        .param("userId", String.valueOf(userId))
                        .param("authToken", token)
                        .param("timezone", "America/Chicago")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(taskPayload)))
                .andExpect(status().isOk())
                .andReturn();
        JsonNode created = objectMapper.readTree(createResult.getResponse().getContentAsString());
        long taskId = created.get("id").asLong();

        Optional<Task> beforeComplete = taskRepository.findById(taskId);
        assertTrue(beforeComplete.isPresent());
        assertNull(beforeComplete.get().getCompletedAt(), "completedAt must be null before marking complete");

        mockMvc.perform(patch("/api/tasks/{id}/complete", taskId)
                        .param("authToken", token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("completed", true))))
                .andExpect(status().isOk());

        Task afterComplete = taskRepository.findById(taskId).orElseThrow();
        assertTrue(afterComplete.isCompleted());
        assertNotNull(afterComplete.getCompletedAt(), "completedAt should be stamped once marked complete");

        mockMvc.perform(patch("/api/tasks/{id}/complete", taskId)
                        .param("authToken", token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("completed", false))))
                .andExpect(status().isOk());

        Task afterUncomplete = taskRepository.findById(taskId).orElseThrow();
        assertFalse(afterUncomplete.isCompleted());
        assertNull(afterUncomplete.getCompletedAt(), "completedAt should be cleared when un-checked");
    }

    @Test
    void taskListExposesCompletedFlagToFrontend() throws Exception {
        JsonNode signUp = signUpTestUser();
        long userId = signUp.get("id").asLong();
        String token = signUp.get("token").asText();

        Map<String, Object> taskPayload = Map.of(
                "title", "Phase1 list-visibility test task",
                "description", "created by automated test",
                "dueDate", "2026-07-11T09:00:00"
        );
        MvcResult createResult = mockMvc.perform(post("/api/tasks")
                        .param("userId", String.valueOf(userId))
                        .param("authToken", token)
                        .param("timezone", "America/Chicago")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(taskPayload)))
                .andExpect(status().isOk())
                .andReturn();
        JsonNode created = objectMapper.readTree(createResult.getResponse().getContentAsString());
        long taskId = created.get("id").asLong();

        mockMvc.perform(patch("/api/tasks/{id}/complete", taskId)
                        .param("authToken", token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("completed", true))))
                .andExpect(status().isOk());

        mockMvc.perform(get("/api/tasks")
                        .param("userId", String.valueOf(userId))
                        .param("authToken", token)
                        .param("timezone", "America/Chicago"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[?(@.id == " + taskId + ")].completed").value(true));
    }
}
