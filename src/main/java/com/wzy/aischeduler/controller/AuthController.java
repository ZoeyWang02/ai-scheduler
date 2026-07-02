package com.wzy.aischeduler.controller;

import java.time.Instant;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;

import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.wzy.aischeduler.dto.AuthResponseDTO;
import com.wzy.aischeduler.entity.User;
import com.wzy.aischeduler.repository.UserRepository;
import com.wzy.aischeduler.service.AuthService;

@RestController
@RequestMapping("/api/auth")
public class AuthController {
    private static final long PASSWORD_RESET_TTL_SECONDS = 600;
    private static final String GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
    private static final String GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
    private static final String GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo";
    private final ConcurrentMap<String, PasswordResetCode> passwordResetCodes = new ConcurrentHashMap<>();
    private final ConcurrentMap<String, Instant> oauthStates = new ConcurrentHashMap<>();
    private final HttpClient httpClient = HttpClient.newHttpClient();
    private final ObjectMapper objectMapper = new ObjectMapper();

    @Value("${google.oauth.client-id:}")
    private String googleClientId;

    @Value("${google.oauth.client-secret:}")
    private String googleClientSecret;

    @Value("${google.oauth.redirect-uri:}")
    private String googleRedirectUri;

    @Autowired
    private UserRepository userRepository;

    @Autowired
    private AuthService authService;

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
        user.setPasswordHash(authService.hashPassword(password));
        user.setAuthToken(authService.issueToken());
        if (request.getTimezone() != null && !request.getTimezone().isBlank()) {
            user.setTimezone(request.getTimezone());
        }

        return ResponseEntity.ok(AuthResponseDTO.from(userRepository.save(user)));
    }

    @PostMapping("/signin")
    public ResponseEntity<?> signIn(@RequestBody AuthRequest request) {
        String identifier = normalizeIdentifier(request.getIdentifier());
        String password = request.getPassword();
        if (identifier == null || password == null || password.isBlank()) {
            return ResponseEntity.badRequest().body(Map.of("message", "Username/email and password are required"));
        }

        return findByIdentifier(identifier)
                .filter(user -> authService.verifyPassword(password, user.getPasswordHash()))
                .<ResponseEntity<?>>map(user -> {
                    if (authService.isLegacyHash(user.getPasswordHash())) {
                        user.setPasswordHash(authService.hashPassword(password));
                    }
                    user.setAuthToken(authService.issueToken());
                    return ResponseEntity.ok(AuthResponseDTO.from(userRepository.save(user)));
                })
                .orElseGet(() -> ResponseEntity.status(401).body(Map.of("message", "Invalid username/email or password")));
    }

    @PostMapping("/password-reset/request")
    public ResponseEntity<?> requestPasswordReset(@RequestBody AuthRequest request) {
        String email = normalizeEmail(request.getEmail());
        if (email == null) {
            return ResponseEntity.badRequest().body(Map.of("message", "Email is required"));
        }

        Optional<User> user = userRepository.findByEmail(email);
        if (user.isPresent()) {
            String code = authService.issueVerificationCode();
            passwordResetCodes.put(email, new PasswordResetCode(code, Instant.now().plusSeconds(PASSWORD_RESET_TTL_SECONDS)));
            System.out.println("[DEV] Password reset code for " + email + ": " + code);
        }

        return ResponseEntity.ok(Map.of(
                "message", "Verification code sent if the email exists. In local development, check the backend log."
        ));
    }

    @PostMapping("/password-reset/confirm")
    public ResponseEntity<?> confirmPasswordReset(@RequestBody AuthRequest request) {
        String email = normalizeEmail(request.getEmail());
        String code = request.getCode() == null ? null : request.getCode().trim();
        String password = request.getPassword();
        if (email == null || code == null || code.isBlank() || password == null || password.length() < 6) {
            return ResponseEntity.badRequest().body(Map.of("message", "Email, verification code, and a password of at least 6 characters are required"));
        }

        PasswordResetCode resetCode = passwordResetCodes.get(email);
        if (resetCode == null || resetCode.expiresAt().isBefore(Instant.now()) || !resetCode.code().equals(code)) {
            return ResponseEntity.status(400).body(Map.of("message", "Invalid or expired verification code"));
        }

        User user = userRepository.findByEmail(email)
                .orElseThrow(() -> new IllegalArgumentException("User not found"));
        user.setPasswordHash(authService.hashPassword(password));
        user.setAuthToken(null);
        userRepository.save(user);
        passwordResetCodes.remove(email);
        return ResponseEntity.ok(Map.of("message", "Password reset. Please sign in again."));
    }

    @PostMapping("/oauth/{provider}/start")
    public ResponseEntity<?> startExternalAuth(@PathVariable String provider) {
        String normalizedProvider = provider == null ? "" : provider.trim().toLowerCase();
        if (!normalizedProvider.matches("google|apple|sso")) {
            return ResponseEntity.badRequest().body(Map.of("message", "Unsupported identity provider"));
        }
        if ("google".equals(normalizedProvider)) {
            if (!isGoogleConfigured()) {
                return ResponseEntity.status(HttpStatus.NOT_IMPLEMENTED).body(Map.of("message", "Google OAuth is not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI."));
            }
            return ResponseEntity.ok(Map.of("authorizationUrl", buildGoogleAuthorizationUrl()));
        }
        return ResponseEntity.status(HttpStatus.NOT_IMPLEMENTED).body(Map.of(
                "message", "OAuth/SSO provider is not configured yet. Add client id, client secret, redirect URI, and callback handling before enabling " + normalizedProvider + " sign-in."
        ));
    }

    @GetMapping("/oauth/google/start")
    public ResponseEntity<?> redirectToGoogle() {
        if (!isGoogleConfigured()) {
            return ResponseEntity.status(HttpStatus.NOT_IMPLEMENTED).body("Google OAuth is not configured.");
        }
        return ResponseEntity.status(HttpStatus.FOUND)
                .header(HttpHeaders.LOCATION, buildGoogleAuthorizationUrl())
                .build();
    }

    @GetMapping("/oauth/google/callback")
    public ResponseEntity<?> handleGoogleCallback(@RequestParam(required = false) String code,
                                                  @RequestParam(required = false) String state,
                                                  @RequestParam(required = false) String error) {
        if (error != null) {
            return oauthCallbackPage("Google sign-in failed: " + escapeForScript(error), null);
        }
        if (code == null || state == null || !isValidOAuthState(state)) {
            return oauthCallbackPage("Google sign-in state is invalid or expired.", null);
        }
        try {
            String accessToken = exchangeGoogleCode(code);
            JsonNode profile = fetchGoogleProfile(accessToken);
            String email = normalizeEmail(profile.path("email").asText(null));
            if (email == null) {
                return oauthCallbackPage("Google did not return an email address.", null);
            }

            String displayName = profile.path("name").asText(email.substring(0, email.indexOf('@')));
            User user = userRepository.findByEmail(email).orElseGet(User::new);
            user.setEmail(email);
            if (user.getUsername() == null || user.getUsername().isBlank()) {
                user.setUsername(uniqueGoogleUsername(email));
            }
            user.setName(displayName);
            user.setAuthToken(authService.issueToken());
            User savedUser = userRepository.save(user);
            return oauthCallbackPage(null, AuthResponseDTO.from(savedUser));
        } catch (Exception exception) {
            return oauthCallbackPage("Google sign-in failed. " + escapeForScript(exception.getMessage()), null);
        }
    }

    private boolean isGoogleConfigured() {
        return googleClientId != null && !googleClientId.isBlank()
                && googleClientSecret != null && !googleClientSecret.isBlank()
                && googleRedirectUri != null && !googleRedirectUri.isBlank();
    }

    private String buildGoogleAuthorizationUrl() {
        String state = UUID.randomUUID().toString();
        oauthStates.put(state, Instant.now().plusSeconds(600));
        return GOOGLE_AUTH_URL
                + "?client_id=" + urlEncode(googleClientId)
                + "&redirect_uri=" + urlEncode(googleRedirectUri)
                + "&response_type=code"
                + "&scope=" + urlEncode("openid email profile")
                + "&state=" + urlEncode(state)
                + "&prompt=select_account";
    }

    private boolean isValidOAuthState(String state) {
        Instant expiresAt = oauthStates.remove(state);
        return expiresAt != null && expiresAt.isAfter(Instant.now());
    }

    private String exchangeGoogleCode(String code) throws Exception {
        String form = "code=" + urlEncode(code)
                + "&client_id=" + urlEncode(googleClientId)
                + "&client_secret=" + urlEncode(googleClientSecret)
                + "&redirect_uri=" + urlEncode(googleRedirectUri)
                + "&grant_type=authorization_code";
        HttpRequest request = HttpRequest.newBuilder(URI.create(GOOGLE_TOKEN_URL))
                .header("Content-Type", "application/x-www-form-urlencoded")
                .POST(HttpRequest.BodyPublishers.ofString(form))
                .build();
        HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
        if (response.statusCode() < 200 || response.statusCode() >= 300) {
            throw new IllegalStateException("Token exchange failed with status " + response.statusCode());
        }
        JsonNode json = objectMapper.readTree(response.body());
        String accessToken = json.path("access_token").asText(null);
        if (accessToken == null || accessToken.isBlank()) {
            throw new IllegalStateException("Token response did not include an access token");
        }
        return accessToken;
    }

    private JsonNode fetchGoogleProfile(String accessToken) throws Exception {
        HttpRequest request = HttpRequest.newBuilder(URI.create(GOOGLE_USERINFO_URL))
                .header("Authorization", "Bearer " + accessToken)
                .GET()
                .build();
        HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
        if (response.statusCode() < 200 || response.statusCode() >= 300) {
            throw new IllegalStateException("Userinfo request failed with status " + response.statusCode());
        }
        return objectMapper.readTree(response.body());
    }

    private String uniqueGoogleUsername(String email) {
        String base = normalizeUsername(email.substring(0, email.indexOf('@')).replaceAll("[^a-zA-Z0-9._-]", ""));
        if (base == null || base.isBlank()) {
            base = "google-user";
        }
        String candidate = base;
        int suffix = 1;
        while (userRepository.findByUsername(candidate).isPresent()) {
            candidate = base + suffix++;
        }
        return candidate;
    }

    private ResponseEntity<String> oauthCallbackPage(String error, AuthResponseDTO user) {
        String script;
        if (user == null) {
            script = "localStorage.setItem('nexusOAuthError', '" + escapeForScript(error) + "');";
        } else {
            try {
                script = "localStorage.setItem('nexusUser', " + objectMapper.writeValueAsString(objectMapper.writeValueAsString(user)) + ");";
            } catch (Exception exception) {
                script = "localStorage.setItem('nexusOAuthError', 'Unable to save OAuth session.');";
            }
        }
        String html = "<!doctype html><html><body><script>"
                + script
                + "window.location.replace('/');"
                + "</script></body></html>";
        return ResponseEntity.ok().header(HttpHeaders.CONTENT_TYPE, "text/html; charset=UTF-8").body(html);
    }

    private String urlEncode(String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8);
    }

    private String escapeForScript(String value) {
        if (value == null) {
            return "";
        }
        return value.replace("\\", "\\\\").replace("'", "\\'").replace("\n", " ");
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

    private Optional<User> findByIdentifier(String identifier) {
        if (identifier.contains("@")) {
            return userRepository.findByEmail(identifier);
        }
        return userRepository.findByUsername(identifier);
    }

    public static class AuthRequest {
        private String identifier;
        private String username;
        private String email;
        private String password;
        private String code;
        private String timezone;

        public String getIdentifier() { return identifier; }
        public void setIdentifier(String identifier) { this.identifier = identifier; }

        public String getUsername() { return username; }
        public void setUsername(String username) { this.username = username; }

        public String getEmail() { return email; }
        public void setEmail(String email) { this.email = email; }

        public String getPassword() { return password; }
        public void setPassword(String password) { this.password = password; }

        public String getCode() { return code; }
        public void setCode(String code) { this.code = code; }

        public String getTimezone() { return timezone; }
        public void setTimezone(String timezone) { this.timezone = timezone; }
    }

    private record PasswordResetCode(String code, Instant expiresAt) {}
}
