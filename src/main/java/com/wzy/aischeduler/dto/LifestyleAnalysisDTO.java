package com.wzy.aischeduler.dto;

import java.util.List;

public class LifestyleAnalysisDTO {
    private String period;
    private String focusStyle;
    private String peakWindow;
    private String rhythmLabel;
    private String recommendation;
    private int totalTasks;
    private int completedTasks;
    private List<TimeBucketDTO> timeBuckets;
    private List<HourlyStudyDTO> hourlyStudy;

    public String getPeriod() {
        return period;
    }

    public void setPeriod(String period) {
        this.period = period;
    }

    public String getFocusStyle() {
        return focusStyle;
    }

    public void setFocusStyle(String focusStyle) {
        this.focusStyle = focusStyle;
    }

    public String getPeakWindow() {
        return peakWindow;
    }

    public void setPeakWindow(String peakWindow) {
        this.peakWindow = peakWindow;
    }

    public String getRhythmLabel() {
        return rhythmLabel;
    }

    public void setRhythmLabel(String rhythmLabel) {
        this.rhythmLabel = rhythmLabel;
    }

    public String getRecommendation() {
        return recommendation;
    }

    public void setRecommendation(String recommendation) {
        this.recommendation = recommendation;
    }

    public int getTotalTasks() {
        return totalTasks;
    }

    public void setTotalTasks(int totalTasks) {
        this.totalTasks = totalTasks;
    }

    public int getCompletedTasks() {
        return completedTasks;
    }

    public void setCompletedTasks(int completedTasks) {
        this.completedTasks = completedTasks;
    }

    public List<TimeBucketDTO> getTimeBuckets() {
        return timeBuckets;
    }

    public void setTimeBuckets(List<TimeBucketDTO> timeBuckets) {
        this.timeBuckets = timeBuckets;
    }

    public List<HourlyStudyDTO> getHourlyStudy() {
        return hourlyStudy;
    }

    public void setHourlyStudy(List<HourlyStudyDTO> hourlyStudy) {
        this.hourlyStudy = hourlyStudy;
    }

    public static class TimeBucketDTO {
        private String label;
        private int count;
        private int percentage;

        public TimeBucketDTO(String label, int count, int percentage) {
            this.label = label;
            this.count = count;
            this.percentage = percentage;
        }

        public String getLabel() {
            return label;
        }

        public void setLabel(String label) {
            this.label = label;
        }

        public int getCount() {
            return count;
        }

        public void setCount(int count) {
            this.count = count;
        }

        public int getPercentage() {
            return percentage;
        }

        public void setPercentage(int percentage) {
            this.percentage = percentage;
        }
    }

    public static class HourlyStudyDTO {
        private int hour;
        private double hours;

        public HourlyStudyDTO(int hour, double hours) {
            this.hour = hour;
            this.hours = hours;
        }

        public int getHour() {
            return hour;
        }

        public void setHour(int hour) {
            this.hour = hour;
        }

        public double getHours() {
            return hours;
        }

        public void setHours(double hours) {
            this.hours = hours;
        }
    }
}
