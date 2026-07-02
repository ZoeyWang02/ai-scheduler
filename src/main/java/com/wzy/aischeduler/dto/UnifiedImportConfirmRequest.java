package com.wzy.aischeduler.dto;

import java.util.List;

public class UnifiedImportConfirmRequest {
    private String importId;
    private List<String> itemIds;

    public String getImportId() { return importId; }
    public void setImportId(String importId) { this.importId = importId; }

    public List<String> getItemIds() { return itemIds; }
    public void setItemIds(List<String> itemIds) { this.itemIds = itemIds; }
}
