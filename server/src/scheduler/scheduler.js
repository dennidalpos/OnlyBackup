const chokidar = require('chokidar');
const path = require('path');

class Scheduler {
  constructor(storage, logger, config, jobExecutor) {
    this.storage = storage;
    this.logger = logger;
    this.config = config;
    this.jobExecutor = jobExecutor;
    this.scheduledJobs = new Map();
    this.checkInterval = config.scheduler?.checkInterval || 60000;
    this.checkIntervalId = null;
    this.watcher = null;
  }

  async start() {
    this.logger.debug('Avvio scheduler');

    await this.reloadJobs();

    this.checkIntervalId = setInterval(() => this.checkScheduledJobs(), this.checkInterval);

    if (this.config.scheduler?.enableFileWatcher) {
      this.startFileWatcher();
    }

    this.logger.debug('Scheduler avviato', {
      scheduledJobsCount: this.scheduledJobs.size,
      checkInterval: this.checkInterval
    });
  }

  stop() {
    this.logger.debug('Arresto scheduler');

    if (this.checkIntervalId) {
      clearInterval(this.checkIntervalId);
      this.checkIntervalId = null;
    }

    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }

    for (const [jobId, scheduledJob] of this.scheduledJobs.entries()) {
      if (scheduledJob.timeoutId) {
        clearTimeout(scheduledJob.timeoutId);
      }
    }

    this.scheduledJobs.clear();
    this.logger.debug('Scheduler arrestato');
  }

  async reloadJobs() {
    this.logger.debug('Ricaricamento job');

    for (const [jobId, scheduledJob] of this.scheduledJobs.entries()) {
      if (scheduledJob.timeoutId) {
        clearTimeout(scheduledJob.timeoutId);
      }
    }
    this.scheduledJobs.clear();

    const jobs = this.storage.loadAllJobs();

    for (const job of jobs) {
      if (!job.enabled) {
        continue;
      }

      const schedule = job.schedule;

      if (!schedule) {
        this.logger.warn('Schedule non definita per job', { jobId: job.job_id });
        continue;
      }

      this.scheduleJob(job, schedule);
    }

    this.logger.debug('Job ricaricati', { count: this.scheduledJobs.size });
  }

  scheduleJob(job, schedule) {
    const nextRun = this.calculateNextRun(schedule);

    if (!nextRun) {
      this.logger.warn('Impossibile calcolare prossima esecuzione', {
        jobId: job.job_id,
        schedule
      });
      return;
    }

    this.scheduledJobs.set(job.job_id, {
      job,
      schedule,
      nextRun,
      timeoutId: null
    });

    this.logger.logJobScheduled(job.job_id, 'scheduled', nextRun);
  }

  calculateNextRun(schedule) {
    if (!schedule || !schedule.type) {
      return null;
    }

    const now = new Date();
    let nextRun = null;

    try {
      switch (schedule.type) {
        case 'once':
          nextRun = this.calculateOnceSchedule(schedule, now);
          break;
        case 'daily':
          nextRun = this.calculateDailySchedule(schedule, now);
          break;
        case 'weekly':
          nextRun = this.calculateWeeklySchedule(schedule, now);
          break;
        case 'monthly':
          nextRun = this.calculateMonthlySchedule(schedule, now);
          break;
        default:
          this.logger.warn('Tipo schedule non riconosciuto', { type: schedule.type });
          return null;
      }
    } catch (error) {
      this.logger.error('Errore calcolo prossima esecuzione', {
        schedule,
        error: error.message
      });
      return null;
    }

    return nextRun;
  }

  calculateOnceSchedule(schedule, now) {
    const startDate = schedule.start_date ? new Date(schedule.start_date) : now;
    const startTime = schedule.start_time || '00:00';
    const [hours, minutes] = startTime.split(':').map(Number);

    const nextRun = new Date(startDate);
    nextRun.setHours(hours, minutes, 0, 0);

    if (nextRun <= now) {
      return null;
    }

    return nextRun;
  }

  calculateDailySchedule(schedule, now) {
    const times = Array.isArray(schedule.times) && schedule.times.length > 0
      ? schedule.times
      : [schedule.start_time || '00:00'];

    const sortedTimes = times
      .filter(t => /^([01]\d|2[0-3]):[0-5]\d$/.test(t))
      .sort();

    if (sortedTimes.length === 0) {
      return null;
    }

    const scheduledDays = Array.isArray(schedule.days) && schedule.days.length > 0
      ? schedule.days
      : [1, 2, 3, 4, 5];

    let candidateDay = new Date(now);
    candidateDay.setHours(0, 0, 0, 0);

    for (let dayOffset = 0; dayOffset < 14; dayOffset++) {
      const dayOfWeek = candidateDay.getDay();

      if (scheduledDays.includes(dayOfWeek)) {
        for (const time of sortedTimes) {
          const [hours, minutes] = time.split(':').map(Number);
          const nextRun = new Date(candidateDay);
          nextRun.setHours(hours, minutes, 0, 0);

          if (nextRun > now) {
            return nextRun;
          }
        }
      }

      candidateDay.setDate(candidateDay.getDate() + 1);
    }

    return null;
  }

  calculateWeeklySchedule(schedule, now) {
    const startTime = schedule.start_time || '00:00';
    const [hours, minutes] = startTime.split(':').map(Number);
    const daysOfWeek = schedule.days_of_week || [1];
    const everyNWeeks = schedule.every_n_weeks || 1;

    let nextRun = new Date(now);
    nextRun.setHours(hours, minutes, 0, 0);

    for (let i = 0; i < 7 * everyNWeeks; i++) {
      const dayOfWeek = nextRun.getDay();
      const adjustedDay = dayOfWeek === 0 ? 7 : dayOfWeek;

      if (daysOfWeek.includes(adjustedDay) && nextRun > now) {
        return nextRun;
      }

      nextRun.setDate(nextRun.getDate() + 1);
    }

    return nextRun;
  }

  calculateMonthlySchedule(schedule, now) {
    const startTime = schedule.start_time || '00:00';
    const [hours, minutes] = startTime.split(':').map(Number);
    const daysOfMonth = schedule.days_of_month || [1];

    let nextRun = new Date(now);
    nextRun.setHours(hours, minutes, 0, 0);

    for (let i = 0; i < 60; i++) {
      const dayOfMonth = nextRun.getDate();

      if (daysOfMonth.includes(dayOfMonth) && nextRun > now) {
        return nextRun;
      }

      nextRun.setDate(nextRun.getDate() + 1);
    }

    return nextRun;
  }

  checkScheduledJobs() {
    const now = new Date();

    for (const [jobId, scheduledJob] of this.scheduledJobs.entries()) {
      if (scheduledJob.nextRun && now >= scheduledJob.nextRun) {
        this.executeJob(jobId);
      }
    }
  }

  async executeJob(jobId) {
    const scheduledJob = this.scheduledJobs.get(jobId);

    if (!scheduledJob) {
      return;
    }

    const { job } = scheduledJob;

    this.logger.debug('Esecuzione job schedulata', {
      jobId,
      clientHostname: job.client_hostname
    });

    try {
      await this.jobExecutor.executeJob(job);

      if (scheduledJob.schedule.type !== 'once') {
        const nextRun = this.calculateNextRun(scheduledJob.schedule);
        scheduledJob.nextRun = nextRun;
        this.logger.logJobScheduled(job.job_id, 'scheduled', nextRun);
      } else {
        this.scheduledJobs.delete(jobId);
        this.logger.debug('Job "once" completato e rimosso', { jobId });
      }
    } catch (error) {
      this.logger.error('Errore esecuzione job schedulata', {
        jobId,
        error: error.message
      });
    }
  }

  async executeJobManually(jobId) {
    const job = this.storage.loadJob(jobId);

    if (!job) {
      const error = new Error(`Job ${jobId} non trovato`);
      error.code = 'JOB_NOT_FOUND';
      throw error;
    }

    if (this.jobExecutor.isJobRunning(jobId)) {
      const error = new Error(`Job ${jobId} già in esecuzione`);
      error.code = 'JOB_RUNNING';
      throw error;
    }

    this.logger.debug('Esecuzione manuale job', { jobId });

    return await this.jobExecutor.executeJob(job);
  }

  startFileWatcher() {
    const jobsDir = path.join(this.config.dataRoot, 'state', 'jobs');

    this.watcher = chokidar.watch([jobsDir], {
      persistent: true,
      ignoreInitial: true
    });

    this.watcher.on('change', async (filePath) => {
      this.logger.debug('File modificato, ricaricamento job', { filePath });
      await this.reloadJobs();
    });

    this.watcher.on('add', async (filePath) => {
      this.logger.debug('File aggiunto, ricaricamento job', { filePath });
      await this.reloadJobs();
    });

    this.watcher.on('unlink', async (filePath) => {
      this.logger.debug('File eliminato, ricaricamento job', { filePath });
      await this.reloadJobs();
    });

    this.logger.debug('File watcher avviato', { paths: [jobsDir] });
  }

  getScheduledJobs() {
    const result = [];

    for (const [jobId, scheduledJob] of this.scheduledJobs.entries()) {
      result.push({
        job_id: jobId,
        client_hostname: scheduledJob.job.client_hostname,
        next_run: scheduledJob.nextRun,
        enabled: scheduledJob.job.enabled,
        schedule: scheduledJob.schedule
      });
    }

    return result;
  }
}

module.exports = Scheduler;
