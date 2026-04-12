# AI-Scheduler 🗓️🤖

![Java](https://img.shields.io/badge/Java-17+-orange.svg)
![Spring Boot](https://img.shields.io/badge/Spring_Boot-3.x-brightgreen.svg)
![MySQL](https://img.shields.io/badge/MySQL-8.0-blue.svg)
![Neo4j](https://img.shields.io/badge/Neo4j-Graph_DB-blue.svg)
![LLM](https://img.shields.io/badge/LLM-Spring_AI_/_LangChain4j-green.svg)
![License](https://img.shields.io/badge/License-MIT-lightgrey.svg)

## Overview

**AI-Scheduler** is an intelligent, automated academic scheduling agent designed to reduce the cognitive load of student planning. By seamlessly integrating with Learning Management Systems (LMS) like Canvas and leveraging Large Language Models (LLMs), it transforms unstructured syllabi and project descriptions into granular, actionable time-blocks with complex dependency tracking.

Developed with robust enterprise-grade architecture, this project implements strict Object-Oriented Design (OOD) principles and an LLM Agent system to autonomously decompose tasks and optimize student calendars.

## Core Features

* **Automated Data Ingestion:** Securely authenticates and fetches upcoming assignments and announcements via the Canvas LMS API.
* **LLM-Driven Task Decomposition:** Utilizes an AI Agent to parse complex, unstructured project descriptions, breaking them down into fine-grained sub-tasks with estimated hours.
* **Dependency Modeling:** Leverages a graph database (Neo4j) to map and traverse prerequisite relationships between sub-tasks (e.g., *UML Design* must precede *Code Implementation*).
* **Dynamic Time-Blocking:** An algorithmic scheduler that maps generated sub-tasks into a user's free time slots, ensuring an optimized and conflict-free schedule.

## System Architecture & Tech Stack

The backend is engineered using a scalable Java architecture, ensuring clear separation of concerns through interfaces and design patterns (e.g., Factory, Strategy).

* **Backend Framework:** Java 17+ with Spring Boot for robust RESTful API development and dependency injection.
* **AI Orchestration:** Spring AI (or LangChain4j) for seamless LLM integration, prompt engineering, and structured JSON output mapping.
* **Relational Database:** MySQL (via Spring Data JPA) for managing user profiles, static course metadata, and OAuth tokens.
* **Graph Database:** Neo4j (via Spring Data Neo4j) for efficient querying of complex task dependency chains.
* **Documentation:** Comprehensive UML Class and Use Case diagrams are available in the `/docs` directory.

## Getting Started

### Prerequisites
* Java Development Kit (JDK) 17 or higher
* Maven (or Gradle)
* MySQL Server (8.0+)
* Neo4j Desktop / AuraDB
* Canvas LMS Developer Token
* LLM API Key (e.g., OpenAI)

### 📂 Project Structure

This project follows a standard layered architecture (MVC) to ensure strict separation of concerns and scalability:

```text
ai-scheduler/
├── README.md
├── pom.xml                  <-- The Heart of Maven: Manages all third-party dependencies
└── src/
    ├── main/
    │   ├── java/
    │   │   └── com/yourname/aischeduler/
    │   │       ├── AiSchedulerApplication.java  <-- The entry point to boot up the application
    │   │       │
    │   │       ├── controller/  <-- 🚪 The Facade: Handles incoming HTTP requests from the frontend
    │   │       ├── service/     <-- 🧠 The Brain: Contains core business logic (LLM calls, scheduling)
    │   │       ├── repository/  <-- 🗄️ The Data Layer: Interacts directly with PostgreSQL (JPA/SQL)
    │   │       ├── entity/      <-- 🧬 The Entities: Maps directly to your database tables
    │   │       ├── dto/         <-- 📦 The Delivery Boxes: Data Transfer Objects
    │   │       └── config/      <-- ⚙️ The Configuration: Stores settings (CORS, AI API keys)
    │   │
    │   └── resources/
    │       └── application.properties <-- Database credentials, server ports, and external API keys
```

### Installation

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/JoeyWang02/ai-scheduler.git
    cd ai-scheduler
    ```

2.  **Configure Application Properties:**
    Locate the `src/main/resources/application.properties` (or `.yml`) file and update your credentials:
    ```properties
    # Database Configuration
    spring.datasource.url=jdbc:mysql://localhost:3306/aischeduler
    spring.datasource.username=root
    spring.datasource.password=your_password
    
    # Neo4j Configuration
    spring.neo4j.uri=bolt://localhost:7687
    spring.neo4j.authentication.username=neo4j
    spring.neo4j.authentication.password=your_password

    # External APIs
    canvas.api.url=[https://canvas.instructure.com](https://canvas.instructure.com)
    canvas.api.token=your_canvas_token_here
    spring.ai.openai.api-key=your_llm_api_key_here
    ```

3.  **Build the project:**
    ```bash
    mvn clean install
    ```

4.  **Run the application:**
    ```bash
    mvn spring-boot:run
    ```

## Roadmap
- [x] Canvas API Integration & Authentication (Spring WebClient)
- [ ] LLM Agent Setup via Spring AI
- [ ] Database Schema Definition & JPA Entity Mapping
- [ ] Scheduling Algorithm Implementation
- [ ] REST API endpoints for Frontend consumption

## Contributing
Contributions, issues, and feature requests are welcome! Feel free to check the [issues page](https://github.com/your-username/ai-scheduler/issues).

## License
This project is [MIT](https://choosealicense.com/licenses/mit/) licensed.
