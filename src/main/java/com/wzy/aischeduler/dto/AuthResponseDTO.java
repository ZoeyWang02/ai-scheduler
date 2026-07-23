package com.wzy.aischeduler.dto;

import java.util.Map;

import com.wzy.aischeduler.entity.User;

public class AuthResponseDTO {
    private Long id;
    private String username;
    private String email;
    private String name;
    private String timezone;
    private String token;
    private Map<String, Object> preferences;

    public static AuthResponseDTO from(User user) {
        AuthResponseDTO dto = new AuthResponseDTO();
        dto.setId(user.getId());
        dto.setUsername(user.getUsername());
        dto.setEmail(user.getEmail());
        dto.setName(user.getName());
        dto.setTimezone(user.getTimezone());
        dto.setToken(user.getAuthToken());
        dto.setPreferences(user.getPreferences());
        return dto;
    }

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }

    public String getUsername() { return username; }
    public void setUsername(String username) { this.username = username; }

    public String getEmail() { return email; }
    public void setEmail(String email) { this.email = email; }

    public String getName() { return name; }
    public void setName(String name) { this.name = name; }

    public String getTimezone() { return timezone; }
    public void setTimezone(String timezone) { this.timezone = timezone; }

    public String getToken() { return token; }
    public void setToken(String token) { this.token = token; }

    public Map<String, Object> getPreferences() { return preferences; }
    public void setPreferences(Map<String, Object> preferences) { this.preferences = preferences; }
}
