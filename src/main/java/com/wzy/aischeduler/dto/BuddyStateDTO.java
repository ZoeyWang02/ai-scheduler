package com.wzy.aischeduler.dto;

/**
 * Study Buddy 的派生状态：完全从 Task.completedAt / dueDate 实时计算，
 * 不落库、不含任何"随时间衰减"的字段——没有任务发生时，状态保持不变。
 */
public class BuddyStateDTO {

    private String buddyId;          // junimo / chicken / duck / rabbit / slime
    private String stage;            // hatchling / growing / mature
    private int xp;                  // 累计经验值，单调递增
    private int level;               // 细粒度等级，用于比 stage 更频繁的正反馈
    private int xpIntoLevel;         // 当前等级内已经攒了多少 xp
    private int xpPerLevel;          // 升一级需要多少 xp（常量，供前端画进度条）
    private Integer xpToNextStage;   // 距下一成长阶段还差多少 xp；已是最高阶段则为 null
    private int totalTasksCompleted;
    private int earlyCompletions;    // 提前完成的任务数（提前 >0 天）
    private String mood;             // calm / happy / excited —— 只有正向或中性态，没有负面态
    private Boolean justLeveledUp;   // 仅在"刚完成一个任务"的响应里有意义
    private Boolean justAdvancedStage;

    public String getBuddyId() { return buddyId; }
    public void setBuddyId(String buddyId) { this.buddyId = buddyId; }

    public String getStage() { return stage; }
    public void setStage(String stage) { this.stage = stage; }

    public int getXp() { return xp; }
    public void setXp(int xp) { this.xp = xp; }

    public int getLevel() { return level; }
    public void setLevel(int level) { this.level = level; }

    public int getXpIntoLevel() { return xpIntoLevel; }
    public void setXpIntoLevel(int xpIntoLevel) { this.xpIntoLevel = xpIntoLevel; }

    public int getXpPerLevel() { return xpPerLevel; }
    public void setXpPerLevel(int xpPerLevel) { this.xpPerLevel = xpPerLevel; }

    public Integer getXpToNextStage() { return xpToNextStage; }
    public void setXpToNextStage(Integer xpToNextStage) { this.xpToNextStage = xpToNextStage; }

    public int getTotalTasksCompleted() { return totalTasksCompleted; }
    public void setTotalTasksCompleted(int totalTasksCompleted) { this.totalTasksCompleted = totalTasksCompleted; }

    public int getEarlyCompletions() { return earlyCompletions; }
    public void setEarlyCompletions(int earlyCompletions) { this.earlyCompletions = earlyCompletions; }

    public String getMood() { return mood; }
    public void setMood(String mood) { this.mood = mood; }

    public Boolean getJustLeveledUp() { return justLeveledUp; }
    public void setJustLeveledUp(Boolean justLeveledUp) { this.justLeveledUp = justLeveledUp; }

    public Boolean getJustAdvancedStage() { return justAdvancedStage; }
    public void setJustAdvancedStage(Boolean justAdvancedStage) { this.justAdvancedStage = justAdvancedStage; }
}
