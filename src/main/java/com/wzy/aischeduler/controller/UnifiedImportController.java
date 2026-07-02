package com.wzy.aischeduler.controller;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import com.wzy.aischeduler.dto.UnifiedImportConfirmRequest;
import com.wzy.aischeduler.service.AuthService;
import com.wzy.aischeduler.service.UnifiedImportService;

@RestController
@RequestMapping("/api/import")
public class UnifiedImportController {
    private final UnifiedImportService unifiedImportService;
    private final AuthService authService;

    public UnifiedImportController(UnifiedImportService unifiedImportService, AuthService authService) {
        this.unifiedImportService = unifiedImportService;
        this.authService = authService;
    }

    @PostMapping("/preview")
    public ResponseEntity<?> preview(@RequestParam("file") MultipartFile file,
                                     @RequestParam Long userId,
                                     @RequestParam String authToken,
                                     @RequestParam(defaultValue = "America/Chicago") String timezone) {
        try {
            authService.requireUser(userId, authToken);
            return ResponseEntity.ok(unifiedImportService.preview(file, userId, timezone));
        } catch (SecurityException exception) {
            return ResponseEntity.status(401).body(java.util.Map.of("message", exception.getMessage()));
        } catch (Exception exception) {
            return ResponseEntity.badRequest().body(java.util.Map.of("message", exception.getMessage()));
        }
    }

    @PostMapping("/confirm")
    public ResponseEntity<?> confirm(@RequestBody UnifiedImportConfirmRequest request,
                                     @RequestParam Long userId,
                                     @RequestParam String authToken) {
        try {
            authService.requireUser(userId, authToken);
            return ResponseEntity.ok(unifiedImportService.confirm(request.getImportId(), request.getItemIds(), userId));
        } catch (SecurityException exception) {
            return ResponseEntity.status(401).body(java.util.Map.of("message", exception.getMessage()));
        } catch (Exception exception) {
            return ResponseEntity.badRequest().body(java.util.Map.of("message", exception.getMessage()));
        }
    }
}
