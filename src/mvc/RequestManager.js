/**
 * UB RIA Base
 * Copyright 2013 Baidu Inc. All rights reserved.
 *
 * @ignore
 * @file 请求管理类
 * @author otakustay
 * @date $DATE$
 */
define(
    function (require) {
        var u = require('underscore');
        var util = require('er/util');

        /**
         * 请求管理类
         *
         * 本类用户管理一系列的AJAX请求，控制多个同类（通过名称区分）请求发起时的处理
         *
         * @constructor
         */
        function RequestManager(entityName, backendEntityName) {
            this.entityName = entityName;
            this.backendEntityName = backendEntityName;

            this.runningRequests = {};
        }

        var typeRequestConfigs = [];

        var globalRequestConfig = {};
        var globalRunningRequests = {};

        /**
         * 注册一个请求配置
         *
         * @param {Function} Type 提供配置的类型对象
         * @param {string} name 配置名称
         * @param {meta.RequestConfig} config 配置项
         */
        RequestManager.register = function (Type, name, config) {
            var defaults = {
                name: name,
                scope: 'instance',
                policy: 'auto'
            };
            config = util.mix(defaults, config);

            if (config.scope === 'instance') {
                var typeConfig = u.findWhere(typeRequestConfigs, { type: Type });
                if (!typeConfig) {
                    typeConfig = { type: Type, config: {} };
                    typeRequestConfigs.push(typeConfig);
                }

                var configContainer = typeConfig.config;
                if (configContainer.hasOwnProperty(name)) {
                    throw new Error('An instance request config "' + name + '" has already been registered');
                }
                configContainer[name] = config;
            }
            else {
                if (globalRequestConfig.hasOwnProperty(name)) {
                    throw new Error('A global request config "' + name + '" has already been registered');
                }

                globalRequestConfig[name] = config;
            }
        };

        /**
         * 查找请求对应的预注册的配置项
         *
         * @param {Object} data 实例
         * @param {string} name 请求名称
         * @return {Object | null}
         */
        function lookupRequestConfig(instance, name) {
            if (!name) {
                return null;
            }

            var typeConfig = u.findWhere(typeRequestConfigs, { type: instance.constructor });
            return (typeConfig && typeConfig.config[name]) || globalRequestConfig[name] || null;
        }

        /**
         * 处理多个同名请求同时出现的情况
         *
         * @param {RequestManager} requestManager 实例
         * @param {Object} config 请求预先注册的配置项
         * @param {Object} options 本次请求的相关参数
         * @return {er.meta.FakeXHR | undefined}
         */
        function resolveConflict(requestManager, config, options) {
            var runningRequest = requestManager.runningRequests[config.name];
            if (!runningRequest) {
                return;
            }

            var policy = config.policy;
            if (policy === 'auto') {
                // `auto`模式的策略：
                //
                // 1. 如果请求的配置/参数均没有变化，则重用前一个请求
                // 2. 如果有变化：
                //     1. 如果是GET或PUT请求，则并行加载
                //     2. 如果是POST等非幂等的请求，则中断前一个
                var method = options.method.toUpperCase();
                policy = u.isEqual(options, runningRequest.options)
                    ? 'reuse'
                    : (
                        (method === 'GET' || method === 'PUT')
                        ? 'parallel'
                        : 'abort'
                    );
            }

            switch (policy) {
                case 'reuse':
                    return runningRequest.xhr;
                case 'abort':
                    runningRequest.xhr.abort();
                    return;
                default:
                    return;
            }
        }

        /**
         * 在XHR完成后，将之从当前运行的XHR列表中移除
         *
         * @param {RequestManager} requestManager 实例
         * @param {string} name 请求名称
         * @param {er.meta.FakeXHR} xhr 负责请求的`er.meta.FakeXHR`对象
         */
        function detachRunningRequest(requestManager, name, xhr) {
            if (requestManager.runningRequests
                && requestManager.runningRequests[name]
                && requestManager.runningRequests[name].xhr === xhr
            ) {
                requestManager.runningRequests[name] = null;
            }
            if (globalRunningRequests
                && globalRunningRequests[name]
                && globalRunningRequests[name].xhr === xhr
            ) {
                globalRunningRequests[name] = null;
            }
        }

        /**
         * 获取当前数据类负责的实体名称
         *
         * @return {string}
         */
        RequestManager.prototype.getEntityName = function () {
            return this.entityName || '';
        };

        /**
         * 获取当前数据类负责的后端实体名称
         *
         * @return {string}
         */
        RequestManager.prototype.getBackendEntityName = function () {
            return this.backendEntityName || this.getEntityName();
        };

        /**
         * 设置关联的{@link mvc.RequestStrategy}对象
         *
         * @param {mvc.RequestStrategy} requestStrategy 设置的实例
         */
        RequestManager.prototype.setRequestStrategy = function (requestStrategy) {
            this.requestStrategy = requestStrategy;
        };

        /**
         * 获取关联的{@link mvc.RequestStrategy}对象
         *
         * @return {mvc.RequestStrategy}
         */
        RequestManager.prototype.getRequestStrategy = function () {
            return this.requestStrategy;
        };

        /**
         * 获取请求对象
         *
         * @return {meta.Request}
         * @protected
         */
        RequestManager.prototype.getRequest = function (name, data, options) {
            var strategy = this.getRequestStrategy();

            if (typeof name !== 'string') {
                options = name;
                name = null;
            }

            name = strategy.formatName(name, options);

            // 查找已经有的请求配置，如果存在的话需要把`options`进行合并
            var config = lookupRequestConfig(this, name);
            options = util.mix({}, config && config.options, options);
            // 如果`data`是个函数，那么执行一下得到完整的数据对象
            if (typeof data === 'function') {
                data = data(this, options);
            }
            if (typeof options.data === 'function') {
                options.data = options.data(this, options);
            }
            // 合并请求配置里的`data`和发起请求实时给的`data`
            if (data) {
                options.data = util.mix({}, options.data, data);
            }

            options = strategy.formatOptions(options);

            var request = {
                name: name,
                options: options,
                config: config
            };

            if (request.options.url) {
                request.options.url = strategy.formatURL(request.options.url, request.options);
            }

            return request;
        };

        var ajax = require('er/ajax');

        /**
         * 发起一个AJAX请求
         *
         * 重载方式：
         *
         * - `.request(name, data, options)`
         * - `.request(name, data)`
         * - `.request(name)`
         * - `.request(options, data)`
         * - `.request(options)`
         *
         * @param {string} [name] 请求名称
         * @param {Object} [data] 请求数据
         * @param {Object} [options] 请求配置项
         * @return {er.FakeXHR}
         */
        RequestManager.prototype.request = function (name, data, options) {
            var context = this.getRequest(name, data, options);

            if (!context.config) {
                return ajax.request(context.options);
            }

            var xhr = resolveConflict(this, context.config, context.options);
            if (!xhr) {
                xhr = ajax.request(context.options);
                if (name) {
                    // 根据管理的级别，把未完成的请求放到合适的容器里保留
                    var runningRequests = context.config.scope === 'instance'
                        ? this.runningRequests
                        : globalRunningRequests;
                    // 由于`options`是在`auto`模式下决定策略用的，所以也要保留起来
                    runningRequests[name] = {
                        options: context.options,
                        xhr: xhr
                    };
                    // 有时候一个请求中带的数据会很大，因此要尽早让请求对象可回收，
                    // 所以无论请求失败还是成功，统一进行一次移除操作
                    var detachThisRequestFromManager = u.partial(detachRunningRequest, this, context.name, xhr);
                    xhr.ensure(detachThisRequestFromManager);
                }
            }
            return xhr;
        };

        /**
         * 销毁当前实例
         *
         * @override
         * @protected
         */
        RequestManager.prototype.dispose = function () {
            u.each(
                this.runningRequests,
                function (cache) { cache && cache.xhr.abort(); }
            );
            this.runningRequests = null;
        };

        // 以下是常用数据操作方法，方法均为抽象方法，业务系统需实现这些方法

        /**
         * 检索一个实体列表，返回一个分页的结果集
         *
         * @param {Object} query 查询参数
         * @return {er.meta.FakeXHR}
         * @abstract
         */
        RequestManager.prototype.search = function (query) {
            throw new Error('search method is not implemented');
        };

        /**
         * 获取一个实体列表（不分页）
         *
         * @param {Object} query 查询参数
         * @return {er.meta.FakeXHR}
         * @abstract
         */
        RequestManager.prototype.list = function (query) {
            throw new Error('list method is not implemented');
        };

        /**
         * 保存一个实体
         *
         * @param {Object} entity 实体对象
         * @return {er.meta.FakeXHR}
         * @abstract
         */
        RequestManager.prototype.save = function (entity) {
            throw new Error('save method is not implemented');
        };

        /**
         * 更新一个实体
         *
         * @param {Object} entity 实体对象
         * @return {er.meta.FakeXHR}
         * @abstract
         */
        RequestManager.prototype.update = function (entity) {
            throw new Error('update method is not implemented');
        };

        /**
         * 批量更新一个或多个实体的状态
         *
         * 这个方法不应该被直接调用，应该通过`bind`等方法生成明确的业务方法来使用，
         * 如“删除”操作是将状态改为`0`，因此可以按如下实现：
         *
         *     X.prototype.remove = u.partial(X.prototype.updateStatus, 0);
         *
         * 基类默认有`remove`将状态改为`0`，以及`restore`将状态改为`1`两个方法，
         * 如需其它修改状态的方法可以添加
         *
         * @param {number} status 目标状态
         * @param {string[]} ids id集合
         * @return {FakeXHR}
         * @abstract
         */
        RequestManager.prototype.updateStatus = function (status, ids) {
            // 让`status`在前是为了方便通过`bind`或`partial`生成其它的方法
            throw new Error('updateStatus method is not implemented');
        };

        /**
         * 删除一个或多个实体
         *
         * @param {string[]} ids id集合
         * @return {er.meta.FakeXHR}
         */
        RequestManager.prototype.remove = u.partial(RequestManager.prototype.updateStatus, 0);

        /**
         * 恢复一个或多个实体
         *
         * @param {string[]} ids id集合
         * @return {er.meta.FakeXHR}
         */
        RequestManager.prototype.restore = u.partial(RequestManager.prototype.updateStatus, 1);

        /**
         * 获取批量操作前的确认
         *
         * 这个方法不应该被直接调用，应该通过`bind`等方法生成明确的业务方法来使用，
         * 如“删除前询问后端是否满足条件”操作是将状态改为`0`时的情况，因此可以按如下实现：
         *
         *     X.prototype.getRemoveAdvice = u.partial(X.prototype.getAdvice, 0);
         *
         * 基类默认有`getRemoveAdvice`对应{@link RequestManager#remove}方法，
         * 以及`getRestoreAdvice`对应{@link RequestManager#restore}方法，如需其它修改状态的方法可以添加
         *
         * 需要注意的是，为了让系统正常运行，一个修改状态的`xxx`操作，其对应的询问后端方法应该为`getXxxAdvice`，名称一一对应
         *
         * @param {number} status 目标状态
         * @param {string[]} ids id集合
         * @return {er.meta.FakeXHR}
         * @abstract
         */
        RequestManager.prototype.getAdvice = function (status, ids) {
            throw new Error('getAdvice method is not implemented');
        };

        /**
         * 批量删除前确认
         *
         * @param {string[]} ids id集合
         * @return {er.meta.FakeXHR}
         */
        RequestManager.prototype.getRemoveAdvice = u.partial(RequestManager.prototype.getAdvice, 0);

        /**
         * 批量恢复前确认
         *
         * @param {string[]} ids id集合
         * @return {er.meta.FakeXHR}
         */
        RequestManager.prototype.getRestoreAdvice = u.partial(RequestManager.prototype.getAdvice, 1);

        /**
         * 根据id获取单个实体
         *
         * @param {string} id 实体的id
         * @return {er.meta.FakeXHR}
         * @abstract
         */
        RequestManager.prototype.findById = function (id) {
            throw new Error('findById method is not implemented');
        };

        return RequestManager;
    }
);
