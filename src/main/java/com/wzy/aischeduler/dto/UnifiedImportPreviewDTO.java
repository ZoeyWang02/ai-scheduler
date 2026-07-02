package com.wzy.aischeduler.dto;

import java.util.ArrayList;
import java.util.List;

public class UnifiedImportPreviewDTO {
    private String importId;
    private String fileName;
    private String parser;
    private boolean aiFallbackUsed;
    private String summary;
    private List<UnifiedImportItemDTO> items = new ArrayList<>();

    public String getImportId() { return importId; }
    public void setImportId(String importId) { this.importId = importId; }

    public String getFileName() { return fileName; }
    public void setFileName(String fileName) { this.fileName = fileName; }

    public String getParser() { return parser; }
    public void setParser(String parser) { this.parser = parser; }

    public boolean isAiFallbackUsed() { return aiFallbackUsed; }
    public void setAiFallbackUsed(boolean aiFallbackUsed) { this.aiFallbackUsed = aiFallbackUsed; }

    public String getSummary() { return summary; }
    public void setSummary(String summary) { this.summary = summary; }

    public List<UnifiedImportItemDTO> getItems() { return items; }
    public void setItems(List<UnifiedImportItemDTO> items) { this.items = items; }
}
