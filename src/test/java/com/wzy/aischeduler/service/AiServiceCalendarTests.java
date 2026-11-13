package com.wzy.aischeduler.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.time.LocalDate;

import org.junit.jupiter.api.Test;

class AiServiceCalendarTests {

    // 2026-11-12 is a Thursday, so "Friday" is tomorrow, not next week.
    private static final LocalDate THURSDAY = LocalDate.of(2026, 11, 12);

    @Test
    void englishCalendarNamesWeekdaysAndMarksTodayAndTomorrow() {
        String calendar = AiService.buildCalendarContext(THURSDAY, true);
        assertTrue(calendar.startsWith("2026-11-12 Thu (today); 2026-11-13 Fri (tomorrow); 2026-11-14 Sat; "), calendar);
        assertEquals(14, calendar.split("; ").length);
        assertTrue(calendar.endsWith("2026-11-25 Wed"), calendar);
    }

    @Test
    void chineseCalendarMarksTodayTomorrowAndDayAfter() {
        String calendar = AiService.buildCalendarContext(THURSDAY, false);
        assertTrue(calendar.startsWith("2026-11-12 周四（今天）；2026-11-13 周五（明天）；2026-11-14 周六（后天）；"), calendar);
        assertEquals(14, calendar.split("；").length);
    }
}
