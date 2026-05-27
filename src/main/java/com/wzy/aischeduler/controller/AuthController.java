package com.wzy.aischeduler.controller;

import com.wzy.aischeduler.entity.User;
import com.wzy.aischeduler.repository.UserRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.Map;
import java.util.Optional;

@RestController
@RequestMapping("/api/auth")
public class AuthController {

    @Autowired
    private UserRepository userRepository;

    @PostMapping("/signup")
    public ResponseEntity<?> signUp(@RequestBody AuthRequest request) {
        String email = normalizeEmail(request.getEmail());
        String username = normalizeUsername(request.getUsername());
        String password = request.getPassword();
        if (username == null || email == null || password == null || password.length() < 6) {
            return ResponseEntity.badRequest().body(Map.of("message", "Username, email, and a password of at least 6 characters are required"));
        }
        Optional<User> existingByEmail = userRepository.findByEmail(email);
        Optional<User> existingByUsername = userRepository.findByUsername(username);

        if (existingByUsername.isPresent()
                && (existingByEmail.isEmpty() || !existingByUsername.get().getId().equals(existingByEmail.get().getId()))) {
            return ResponseEntity.status(409).body(Map.of("message", "Username already exists"));
        }
        if (existingByEmail.isPresent() && existingByEmail.get().getPasswordHash() != null) {
            return ResponseEntity.status(409).body(Map.of("message", "Email already exists"));
        }

        User user = existingByEmail.orElseGet(User::new);
        user.setUsername(username);
        user.setEmail(email);
        user.setName(username);
        user.setPasswordHash(hashPassword(password));
        if (request.getTimezone() != null && !request.getTimezone().isBlank()) {
            user.setTimezone(request.getTimezone());
        }

        return ResponseEntity.ok(userRepository.save(user));
    }

    @PostMapping("/signin")
    public ResponseEntity<?> signIn(@RequestBody AuthRequest request) {
        String identifier = normalizeIdentifier(request.getIdentifier());
        String password = request.getPassword();
        if (identifier == null || password == null || password.isBlank()) {
            return ResponseEntity.badRequest().body(Map.of("message", "Username/email and password are required"));
        }

        return findByIdentifier(identifier)
                .filter(user -> hashPassword(password).equals(user.getPasswordHash()))
                .<ResponseEntity<?>>map(ResponseEntity::ok)
                .orElseGet(() -> ResponseEntity.status(401).body(Map.of("message", "Invalid username/email or password")));
    }

    private String normalizeEmail(String email) {
        if (email == null || email.isBlank()) {
            return null;
        }
        return email.trim().toLowerCase();
    }

    private String normalizeUsername(String username) {
        if (username == null || username.isBlank()) {
            return null;
        }
        return username.trim().toLowerCase();
    }

    private String normalizeIdentifier(String identifier) {
        if (identifier == null || identifier.isBlank()) {
            return null;
        }
        return identifier.trim().toLowerCase();
    }

    private java.util.Optional<User> findByIdentifier(String identifier) {
        if (identifier.contains("@")) {
            return userRepository.findByEmail(identifier);
        }
        return userRepository.findByUsername(identifier);
    }

    private String hashPassword(String password) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hashed = digest.digest(password.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(hashed);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 is not available", e);
        }
    }

    public static class AuthRequest {
        private String identifier;
        private String username;
        private String email;
        private String password;
        private String timezone;

        public String getIdentifier() {
            return identifier;
        }

        public void setIdentifier(String identifier) {
            this.identifier = identifier;
        }

        public String getUsername() {
            return username;
        }

        public void setUsername(String username) {
            this.username = username;
        }

        public String getEmail() {
            return email;
        }

        public void setEmail(String email) {
            this.email = email;
        }

        public String getPassword() {
            return password;
        }

        public void setPassword(String password) {
            this.password = password;
        }

        public String getTimezone() {
            return timezone;
        }

        public void setTimezone(String timezone) {
            this.timezone = timezone;
        }
    }
}
