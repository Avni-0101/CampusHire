const express = require("express");
const Job = require("../models/Job");
const Student = require("../models/Student");
const { protect, authorizeRecruiter } = require("../middleware/authMiddleware");
const sendEmail = require("../utils/sendEmail");

const router = express.Router();

//Create a job posting (Only recruiters)
router.post("/create", protect, async (req, res) => {
    try {
        console.log("Authenticated User:", req.user);

        if (!req.user || !req.user.org_name) {
            console.log("Recruiter Check Failed: User is missing org_name");
            return res.status(403).json({ error: "Access denied. Only recruiters can post jobs." });
        }

        const job = new Job({ ...req.body, company_id: req.user._id });
        await job.save();
        res.status(201).json(job);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// Get all job postings (only for eligible branches and courses)
router.get("/", protect, async (req, res) => {
    try {
        const student = await Student.findById(req.user._id);
        if (!student) return res.status(404).json({ error: "Student not found" });

        const { job_type, job_category, participation_type, category } = req.query;

        const query = {
            branches_eligible: { $in: [student.branch] },
            courses_eligible: { $in: [student.course] },
        };

        if (job_type) query.job_type = job_type;
        if (job_category) query.job_category = job_category;

        let jobs = await Job.find(query).populate("company_id", "org_name category participation_type");

        if (req.query.category) {
            jobs = jobs.filter(job => job.company_id?.category === req.query.category);
        }
        if (req.query.participation_type) {
            jobs = jobs.filter(job => job.company_id?.participation_type === req.query.participation_type);
        }

        // Mark expired jobs
        const currentDate = new Date();
        const updates = [];

        for (const job of jobs) {
            if (job.job_deadline < currentDate && job.job_status !== "Expired") {
                job.job_status = "Expired";
                updates.push(job.save({ validateBeforeSave: false }));
            }
        }

        await Promise.all(updates);
        res.json(jobs);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});


// Get jobs posted by the logged-in recruiter
router.get("/recruiter", protect, async (req, res) => {
    try {
        // console.log("Recruiter Check - Authenticated user:", req.user);
        if (!req.user || !req.user.org_name) {
            return res.status(403).json({ error: "Access denied. Only recruiters can view their jobs." });
        }

        const jobs = await Job.find({ company_id: req.user._id }).populate("company_id", "org_name contact_email").populate("applicants", "name email");

        const currentDate = new Date();
        const updates = [];

        for (const job of jobs) {
            if (job.job_deadline < currentDate && job.job_status !== "Expired") {
                job.job_status = "Expired";
                updates.push(job.save({ validateBeforeSave: false }));
            }
        }

        await Promise.all(updates);

        res.json(jobs);

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Edit a job posting (Only recruiters)
router.put("/:jobId", protect, authorizeRecruiter, async (req, res) => {
    try {
        const job = await Job.findById(req.params.jobId);
        if (!job) return res.status(404).json({ error: "Job not found" });

        if (job.company_id.toString() !== req.user._id.toString()) {
            return res.status(403).json({ error: "Unauthorized to edit this job" });
        }

        Object.assign(job, req.body);
        await job.save();

        res.json({ message: "Job updated successfully", job });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Delete a job posting (Only recruiters)
router.delete("/:jobId", protect, authorizeRecruiter, async (req, res) => {
    try {
        // console.log("Job Deletion Request:", req.params.jobId);
        // console.log("Authenticated User:", req.user);

        const job = await Job.findById(req.params.jobId);
        if (!job) {
            console.log("Job Not Found");
            return res.status(404).json({ error: "Job not found" });
        }

        if (job.company_id.toString() !== req.user._id.toString()) {
            console.log("Unauthorized Delete Attempt");
            return res.status(403).json({ error: "Unauthorized to delete this job" });
        }

        await job.deleteOne();
        console.log("Job Deleted Successfully");
        res.json({ message: "Job deleted successfully" });
    } catch (error) {
        console.error("Error deleting job:", error.message);
        res.status(500).json({ error: "Internal Server Error: " + error.message });
    }
});

// Get Applied Jobs for a Student
router.get("/students/applied-jobs", protect, async (req, res) => {
    try {
        if (!req.user || !req.user.name) {
            return res.status(403).json({ error: "Access denied. Only students can view applied jobs." });
        }
        res.json(req.user.applied_jobs);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get a single job by ID
router.get("/:jobId", protect, async (req, res) => {
    try {
        const job = await Job.findById(req.params.jobId).populate("company_id", "org_name");
        if (!job) return res.status(404).json({ error: "Job not found" });
        if (job.job_deadline < new Date() && job.job_status !== "Expired") {
            job.job_status = "Expired";
            await job.save();
        }
        res.json(job);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
