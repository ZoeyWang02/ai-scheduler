package com.wzy.aischeduler;

import com.wzy.aischeduler.service.DataImportService;
import org.springframework.boot.CommandLineRunner;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.context.annotation.Bean;

@SpringBootApplication
public class AiSchedulerApplication {

    public static void main(String[] args) {
        SpringApplication.run(AiSchedulerApplication.class, args);
    }

    // 这段代码确保程序一启动就运行导入逻辑
    @Bean
    public CommandLineRunner run(DataImportService dataImportService) {
        return args -> {
            System.out.println("🚀 程序已启动，开始导入 Canvas 数据...");
            dataImportService.importCanvasData();
        };
    }
}