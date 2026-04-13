# Ai-Schedueler 🗓️🤖

> **Intelligent Academic Flow & Task Decomposition Engine**

[![Java](https://img.shields.io/badge/Java-17+-orange.svg)](https://www.oracle.com/java/)
[![Spring Boot](https://img.shields.io/badge/Spring_Boot-3.x-brightgreen.svg)](https://spring.io/projects/spring-boot)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-15+-blue.svg)](https://www.postgresql.org/)
[![LLM](https://img.shields.io/badge/LLM-GPT--4_/_Gemini-blueviolet.svg)](https://openai.com/)
[![License](https://img.shields.io/badge/License-MIT-lightgrey.svg)](https://opensource.org/licenses/MIT)

## 🌟 Overview

**[Project Name]** (formerly AI-Scheduler) is a high-performance, AI-native academic orchestration system. It is designed to solve the "complexity paralysis" students face when dealing with dense syllabi and multi-stage projects. 

By integrating **RESTful API ingestion** with **Large Language Models (LLMs)**, it doesn't just list tasks—it understands them, decomposes them into logical nodes, and maps them onto a dynamic, interactive calendar.

## ✨ Key Features

* **🧠 Cognitive Decomposition (AI Agent):** Automatically parses unstructured assignment descriptions into granular sub-tasks with intelligent time estimation.
* **📅 Interactive Flow Visualization:** High-performance calendar interface powered by FullCalendar, featuring rich-text tooltips and interactive popups.
* **🌍 Intelligent Time-Sync:** Built-in support for global timezones (e.g., UIUC/Chicago to Beijing), ensuring deadlines are never missed regardless of location.
* **🛠️ Human-in-the-loop Sync:** A unique "AI Planner" interface that allows users to review, edit, and approve AI-generated plans before committing to the database.
* **⚡ Native Data Ingestion:** Direct support for Canvas and Coursera JSON data structures for seamless onboarding.

## 🏗️ System Architecture

The system follows a clean, layered **SDE-grade architecture** emphasizing the Open-Closed Principle:

* **Backend:** Java 17 / Spring Boot 3.x
* **Persistence:** PostgreSQL (JPA/Hibernate) for robust relational data management.
* **AI Integration:** Custom LLM orchestration using Spring RestClient for structured JSON output parsing.
* **Frontend:** Modern "Glassmorphism" UI built with Vanilla JS, FullCalendar API, and Tippy.js for high-fidelity interaction.

## 📂 Project Structure

```text
ai-scheduler/
├── src/main/java/com/wzy/aischeduler/
│   ├── controller/  # REST Endpoints (Task/AI/Upload)
│   ├── service/     # Business Logic & AI Prompt Engineering
│   ├── repository/  # Data Access Layer (JPA)
│   ├── entity/      # Database Schema Models
│   └── dto/         # Data Transfer Objects for API clean-up
└── src/main/resources/
    ├── static/      # Modern Frontend Assets (The "Glass" UI)
    └── application.properties # System Configuration
