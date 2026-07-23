package com.wzy.aischeduler.service;

import java.time.Duration;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;

import org.springframework.stereotype.Service;

import com.wzy.aischeduler.dto.BuddyStateDTO;
import com.wzy.aischeduler.entity.Task;
import com.wzy.aischeduler.entity.User;
import com.wzy.aischeduler.repository.TaskRepository;
import com.wzy.aischeduler.repository.UserRepository;

/**
 * 计算 Study Buddy 的状态：完全从已完成任务（Task.completedAt / dueDate）派生，
 * 不新增表、不落库任何计数器。
 *
 * 设计前提（对应用户反馈：作业不是每天都有，不能套"连续打卡"模型）：
 *  - 没有"衰减"字段。没有任务发生的日子，状态原地不动，不会往负面方向走。
 *  - 唯一的输入事件是"完成任务"，且完成得越早于截止时间，奖励越多——
 *    直接对着拖延问题设计正向激励，而不是靠愧疚/断签惩罚。
 *  - mood 只有 calm / happy / excited 三档，全部非负；最差情况就是回到 calm。
 */
@Service
public class BuddyStateService {

    // --- XP 计算参数 ---
    private static final int BASE_XP = 10;              // 每完成一个任务的基础经验
    private static final int BONUS_PER_DAY_EARLY = 2;    // 每提前一天多给多少经验
    private static final int MAX_EARLY_BONUS_DAYS = 5;   // 提前奖励封顶天数（避免几个月前建的任务经验值爆表）

    // --- 等级 / 成长阶段参数 ---
    private static final int XP_PER_LEVEL = 50;          // 每 50 xp 升一级（细粒度反馈）
    private static final int STAGE_GROWING_XP = 100;     // 达到 100 xp 进入 "growing"
    private static final int STAGE_MATURE_XP = 300;      // 达到 300 xp 进入 "mature"

    // --- mood 参数 ---
    private static final long EXCITED_WINDOW_HOURS = 2;  // 完成任务 2 小时内：excited
    private static final long HAPPY_WINDOW_HOURS = 24;    // 24 小时内：happy，之外：calm

    private static final String DEFAULT_BUDDY_ID = "junimo";

    private final TaskRepository taskRepository;
    private final UserRepository userRepository;

    public BuddyStateService(TaskRepository taskRepository, UserRepository userRepository) {
        this.taskRepository = taskRepository;
        this.userRepository = userRepository;
    }

    /** GET /api/buddy/state 用：当前状态快照。 */
    public BuddyStateDTO getState(Long userId) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new IllegalArgumentException("User not found: " + userId));
        List<Task> completedTasks = completedTasksFor(userId);
        return buildDto(user, completedTasks);
    }

    /**
     * PATCH /complete 用：在"某个任务刚被标记完成"之后调用，
     * 除了返回最新状态，还会标出这一次完成是否恰好跨过了升级线 / 成长阶段线，
     * 前端可以据此决定播放普通完成动画还是升级/进化动画。
     *
     * 如果传入的任务并非"刚被标记完成"（比如用户是取消勾选），则不做升级判断，
     * justLeveledUp / justAdvancedStage 会是 false。
     */
    public BuddyStateDTO getStateAfterCompletionToggle(Long userId, Task toggledTask) {
        List<Task> completedTasks = completedTasksFor(userId);
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new IllegalArgumentException("User not found: " + userId));
        BuddyStateDTO after = buildDto(user, completedTasks);

        boolean justCompleted = toggledTask != null && toggledTask.isCompleted()
                && toggledTask.getCompletedAt() != null;
        if (!justCompleted) {
            after.setJustLeveledUp(false);
            after.setJustAdvancedStage(false);
            return after;
        }

        int taskXp = xpForTask(toggledTask);
        int xpBefore = Math.max(0, after.getXp() - taskXp);
        after.setJustLeveledUp(levelForXp(xpBefore) != after.getLevel());
        after.setJustAdvancedStage(!stageForXp(xpBefore).equals(after.getStage()));
        return after;
    }

    private List<Task> completedTasksFor(Long userId) {
        return taskRepository.findByUserId(userId).stream()
                .filter(Task::isCompleted)
                .filter(t -> t.getCompletedAt() != null)
                .toList();
    }

    private BuddyStateDTO buildDto(User user, List<Task> completedTasks) {
        int totalXp = completedTasks.stream().mapToInt(this::xpForTask).sum();
        int earlyCount = (int) completedTasks.stream().filter(this::isEarly).count();

        BuddyStateDTO dto = new BuddyStateDTO();
        dto.setBuddyId(resolveBuddyId(user));
        dto.setXp(totalXp);
        dto.setLevel(levelForXp(totalXp));
        dto.setXpIntoLevel(totalXp % XP_PER_LEVEL);
        dto.setXpPerLevel(XP_PER_LEVEL);
        dto.setStage(stageForXp(totalXp));
        dto.setXpToNextStage(xpToNextStage(totalXp));
        dto.setTotalTasksCompleted(completedTasks.size());
        dto.setEarlyCompletions(earlyCount);
        dto.setMood(moodFor(completedTasks));
        return dto;
    }

    // --- 纯计算：单个任务的 XP ---
    private int xpForTask(Task task) {
        if (task.getCompletedAt() == null) return 0;
        int xp = BASE_XP;
        long daysEarly = daysEarly(task);
        if (daysEarly > 0) {
            int bonusDays = (int) Math.min(daysEarly, MAX_EARLY_BONUS_DAYS);
            xp += bonusDays * BONUS_PER_DAY_EARLY;
        }
        return xp;
    }

    private boolean isEarly(Task task) {
        return daysEarly(task) > 0;
    }

    /** 提前完成的天数；没有截止时间、或迟到/准点完成，都算 0（不扣分，只是没有加成）。 */
    private long daysEarly(Task task) {
        if (task.getDueDate() == null || task.getCompletedAt() == null) return 0;
        long hoursEarly = Duration.between(task.getCompletedAt(), task.getDueDate()).toHours();
        return hoursEarly > 0 ? hoursEarly / 24 : 0;
    }

    private int levelForXp(int xp) {
        return xp / XP_PER_LEVEL + 1;
    }

    private String stageForXp(int xp) {
        if (xp >= STAGE_MATURE_XP) return "mature";
        if (xp >= STAGE_GROWING_XP) return "growing";
        return "hatchling";
    }

    private Integer xpToNextStage(int xp) {
        if (xp < STAGE_GROWING_XP) return STAGE_GROWING_XP - xp;
        if (xp < STAGE_MATURE_XP) return STAGE_MATURE_XP - xp;
        return null;
    }

    /** calm / happy / excited —— 三档都非负；从不因为"太久没完成任务"而变差。 */
    private String moodFor(List<Task> completedTasks) {
        Optional<LocalDateTime> mostRecent = completedTasks.stream()
                .map(Task::getCompletedAt)
                .filter(Objects::nonNull)
                .max(Comparator.naturalOrder());
        if (mostRecent.isEmpty()) return "calm";

        long hoursSince = Duration.between(mostRecent.get(), LocalDateTime.now(ZoneId.of("UTC"))).toHours();
        if (hoursSince <= EXCITED_WINDOW_HOURS) return "excited";
        if (hoursSince <= HAPPY_WINDOW_HOURS) return "happy";
        return "calm";
    }

    private String resolveBuddyId(User user) {
        Map<String, Object> prefs = user.getPreferences();
        if (prefs != null && prefs.get("studyBuddy") instanceof String buddyId && !buddyId.isBlank()) {
            return buddyId;
        }
        return DEFAULT_BUDDY_ID;
    }
}
