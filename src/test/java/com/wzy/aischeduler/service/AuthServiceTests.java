package com.wzy.aischeduler.service;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

class AuthServiceTests {
    private final AuthService authService = new AuthService(null);

    @Test
    void hashesPasswordsWithSaltedPbkdf2() {
        String first = authService.hashPassword("secret123");
        String second = authService.hashPassword("secret123");

        assertTrue(first.startsWith("pbkdf2$"));
        assertTrue(second.startsWith("pbkdf2$"));
        assertNotEquals(first, second);
        assertTrue(authService.verifyPassword("secret123", first));
        assertFalse(authService.verifyPassword("wrong", first));
    }
}
